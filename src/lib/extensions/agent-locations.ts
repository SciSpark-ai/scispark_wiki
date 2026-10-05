import { constants } from "node:fs"
import { createHash } from "node:crypto"
import { lstat, open, opendir, realpath } from "node:fs/promises"
import { basename, join, resolve, sep } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"
import { DiscoveryRootSchema, IMPORT_LIMITS, PackagePathSchema, type DiscoveryRoot } from "./import-contract"

// Never use agent settings, authentication, sessions or executable hooks as
// discovery input, even if a skill links to them or a folder alias hides them.
const PROTECTED = /^(?:\.git|node_modules|\.venv|__pycache__|\.ssh|\.aws|\.credentials(?:\..*)?|\.claude\.json|\.netrc|\.env(?:\..*)?|auth(?:\..*)?|credentials?(?:\..*)?|secrets?(?:\..*)?|sessions?|session[-_].*|history(?:\..*)?|settings(?:\.local)?\.json|config\.toml|\.mcp\.json|\.lsp\.json)$/i
function protectedPath(path: string) { return path.split(/[\\/]/).some(part => PROTECTED.test(part)) }
export async function canonicalDiscoveryRoots(input: DiscoveryRoot[]): Promise<DiscoveryRoot[]> {
  const roots = z.array(DiscoveryRootSchema).min(1).max(16).parse(input), output: DiscoveryRoot[] = []
  for (const root of roots) {
    const path = await realpath(/* turbopackIgnore: true */ root.path)
    if (path === sep || path === homedir() || protectedPath(path) || !(await lstat(path)).isDirectory()) throw new Error("Discovery permission requires a specific skills or agent folder")
    output.push({ ...root, path })
  }
  return output
}
export type AgentPackage = { rootIndex: number; label: string; sourceKey: string; path: string; files: Map<string, Buffer>; entries: string[] }
/** A single bounded scan; only narrowly recognized locations below explicit
 * canonical roots are enumerated. No environment/home/config-file inference. */
export async function collectAgentPackages(roots: DiscoveryRoot[], assertPermission: () => void): Promise<AgentPackage[]> {
  let visitedEntries = 0, totalBytes = 0
  const packages: AgentPackage[] = []
  const allowed = (path: string) => roots.some(root => path === root.path || path.startsWith(root.path + sep))
  async function canonical(path: string): Promise<string> {
    assertPermission()
    if (protectedPath(path)) throw new Error("Discovery permission excludes protected files")
    const target = await realpath(/* turbopackIgnore: true */ path)
    if (!allowed(target) || protectedPath(target)) throw new Error("Discovery permission: path escapes consented roots")
    return target
  }
  async function exists(path: string) {
    try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
  }
  async function children(path: string) {
    const target = await canonical(path), names: string[] = []
    const directory = await opendir(target)
    for await (const entry of directory) {
      if (++visitedEntries > IMPORT_LIMITS.entries) throw new Error("Discovery entry limit exceeded")
      if (!PROTECTED.test(entry.name)) names.push(entry.name)
    }
    return names.sort()
  }
  async function bytes(path: string, limit = IMPORT_LIMITS.fileBytes): Promise<Buffer> {
    const target = await canonical(path)
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > limit) throw new Error("Discovery file type or size limit")
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        assertPermission(); size += chunk.length; totalBytes += chunk.length
        if (size > limit || totalBytes > IMPORT_LIMITS.expandedBytes) throw new Error("Discovery byte limit exceeded")
        chunks.push(Buffer.from(chunk))
      }
      if (await canonical(path) !== target) throw new Error("Discovery permission: source changed")
      return Buffer.concat(chunks)
    } finally { await file.close() }
  }
  async function snapshot(path: string, rootIndex: number, label: string, skillDirectories?: string[]) {
    const contentRoot = await canonical(path)
    if (contentRoot !== path && !roots.some(root => root.layout !== "config" && (contentRoot === root.path || contentRoot.startsWith(root.path + sep)))) throw new Error("Discovery permission: content root alias needs explicit selection")
    const inContent = async (source: string) => {
      const resolved = await canonical(source)
      if (resolved !== contentRoot && !resolved.startsWith(contentRoot + sep)) throw new Error("Discovery permission: resource escapes content root")
      return resolved
    }
    const files = new Map<string, Buffer>()
    async function walk(directory: string, prefix: string, ancestors: Set<string>) {
      const target = await inContent(directory)
      if (ancestors.has(target) || ancestors.size >= 64) throw new Error("Discovery directory cycle or depth limit")
      const next = new Set([...ancestors, target])
      for (const name of await children(directory)) {
        const local = prefix + name; PackagePathSchema.parse(local)
        const source = join(/* turbopackIgnore: true */ directory, name), resolved = await inContent(source), info = await lstat(resolved)
        if (info.isDirectory()) await walk(source, local + "/", next)
        else if (info.isFile()) files.set(local, await bytes(source))
        else throw new Error("Discovery unsupported source type")
      }
    }
    await walk(path, "", new Set())
    const entries = [...files.keys()].filter(file => basename(file) === "SKILL.md" && (!skillDirectories || skillDirectories.some(dir => dir === "." || file.startsWith(dir + "/"))))
    if (entries.length) packages.push({ rootIndex, label, path: contentRoot, sourceKey: createHash("sha256").update(contentRoot).digest("hex"), files, entries })
    if (packages.length > 1000) throw new Error("Discovery package limit exceeded")
  }
  async function plugin(path: string, rootIndex: number) {
    for (const marker of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
      if (!await exists(join(/* turbopackIgnore: true */ path, marker))) continue
      const metadata: unknown = JSON.parse((await bytes(join(/* turbopackIgnore: true */ path, marker), 1024 * 1024)).toString())
      const parsed = z.object({ name: z.string().max(1000).optional(), skills: z.union([z.string(), z.array(z.string()).max(100)]).optional() }).passthrough().parse(metadata)
      const dirs = ["skills", ...(parsed.skills ? Array.isArray(parsed.skills) ? parsed.skills : [parsed.skills] : [])].map(dir => {
        const normalized = dir.replace(/^\.\//, "").replace(/\/$/, "") || "."
        if (normalized !== ".") PackagePathSchema.parse(normalized)
        return normalized
      })
      if (await exists(join(/* turbopackIgnore: true */ path, "SKILL.md"))) dirs.push(".")
      await snapshot(path, rootIndex, parsed.name || basename(path), dirs); return true
    }
    return false
  }
  async function cache(path: string, rootIndex: number, depth = 0, ancestors = new Set<string>()): Promise<void> {
    const target = await canonical(path)
    if (ancestors.has(target)) throw new Error("Discovery directory cycle")
    if (await plugin(path, rootIndex)) return
    if (depth >= 3) return
    for (const name of await children(path)) {
      const sub = join(/* turbopackIgnore: true */ path, name), target = await canonical(sub)
      if ((await lstat(target)).isDirectory()) await cache(sub, rootIndex, depth + 1, new Set([...ancestors, await canonical(path)]))
    }
  }
  for (const [index, root] of roots.entries()) {
    if (await canonical(root.path) !== root.path) throw new Error("Discovery permission: selected root changed")
    if (root.layout === "skills") await snapshot(root.path, index, `${root.agent} skills`)
    else if (root.layout === "package") { if (!await plugin(root.path, index)) await snapshot(root.path, index, `${root.agent} package`) }
    else if (root.layout === "plugin-cache") await cache(root.path, index)
    else {
      const skillPaths = root.agent === "codex" ? ["skills", ".agents/skills", ".codex/skills"] : ["skills"]
      for (const skillPath of skillPaths) if (await exists(join(/* turbopackIgnore: true */ root.path, skillPath))) await snapshot(join(/* turbopackIgnore: true */ root.path, skillPath), index, `${root.agent} ${skillPath}`)
      const registry = join(/* turbopackIgnore: true */ root.path, "plugins/installed_plugins.json")
      if (await exists(registry)) {
        // This bounded installation inventory is data, never agent settings.
        // It selects recorded versions, not stale cache versions. It does not
        // imply that the source agent enabled the plugin or grant execution.
        const schema = z.object({ version: z.literal(2), plugins: z.record(z.string(), z.array(z.object({ installPath: z.string().min(1).max(4000), scope: z.string().optional(), version: z.string().optional() }).passthrough()).max(100)) }).passthrough()
        const registryData = schema.parse(JSON.parse((await bytes(registry, 1024 * 1024)).toString()))
        const records = Object.values(registryData.plugins).flat()
        if (records.length > 1000) throw new Error("Discovery plugin limit exceeded")
        for (const record of records) {
          const selected = resolve(root.path, "plugins", record.installPath)
          const resolved = await canonical(selected), cacheRoot = join(/* turbopackIgnore: true */ root.path, "plugins", "cache")
          if (!(resolved.startsWith(cacheRoot + sep) && selected.startsWith(cacheRoot + sep)) && !roots.some(chosen => chosen.layout !== "config" && (resolved === chosen.path || resolved.startsWith(chosen.path + sep)))) throw new Error("Discovery permission: installed content needs a separate selection")
          if (!await plugin(selected, index)) throw new Error("Unrecognized installed plugin metadata")
        }
      } else if (root.agent === "codex") {
        for (const cachePath of ["plugins/cache", ".codex/plugins/cache"]) if (await exists(join(/* turbopackIgnore: true */ root.path, cachePath))) await cache(join(/* turbopackIgnore: true */ root.path, cachePath), index)
      }
    }
  }
  return packages
}
