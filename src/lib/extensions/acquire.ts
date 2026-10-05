import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, open, readdir, realpath, rm } from "node:fs/promises"
import { join, posix, sep } from "node:path"
import { lookup } from "node:dns/promises"
import { request } from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"
import { createInflateRaw } from "node:zlib"
import type { WorkflowContext } from "../workflows/context"
import { IMPORT_LIMITS, ImportSourceSchema, PackagePathSchema, StagedPackageSchema, UpdateSourceSchema, type ImportSource, type StagedPackage } from "./import-contract"
import { importStorage, profileRuntimePath } from "./store"

export type AcquisitionOptions = {
  limits?: Partial<Record<keyof typeof IMPORT_LIMITS, number>>
  /** Credentials remain transient. Connection binding/setup is owned by Task 9. */
  githubToken?: () => Promise<string | undefined>
  resolveHost?: (host: string) => Promise<{ address: string; family: number }[]>
  request?: (url: URL, address: { address: string; family: number }, headers: Record<string, string>) => Promise<Response>
}
export class ImportNeedsSetupError extends Error { readonly status = "needs-setup" }
export function sha256(data: string | Uint8Array): string { return createHash("sha256").update(data).digest("hex") }
function limitsFor(options: AcquisitionOptions) {
  const limits: Record<keyof typeof IMPORT_LIMITS, number> = { ...IMPORT_LIMITS }
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    const value = options.limits?.[key] ?? limits[key]
    if (!Number.isSafeInteger(value) || value < 1 || value > IMPORT_LIMITS[key]) throw new Error("Invalid acquisition limit")
    limits[key] = value
  }
  return limits
}
function nestedArchive(path: string, data: Uint8Array) {
  return /\.(zip|tar|tgz|gz|bz2|xz|7z|rar)$/i.test(path) || (data[0] === 0x50 && data[1] === 0x4b && data[2] === 3 && data[3] === 4) || (data[0] === 0x1f && data[1] === 0x8b) || Buffer.from(data.subarray(257, 262)).toString() === "ustar"
}
async function boundedRead(chunks: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  const data: Buffer[] = []; let bytes = 0
  for await (const chunk of chunks) { bytes += chunk.byteLength; if (bytes > limit) throw new Error("Package size limit exceeded"); data.push(Buffer.from(chunk)) }
  return Buffer.concat(data)
}
async function readRegular(path: string, limit: number) {
  if (!(await lstat(path)).isFile()) throw new Error("Unsupported source file type")
  // A FIFO replacing the checked file must never block open. O_NOFOLLOW also
  // rejects a replacement link; descriptor validation rejects all other types.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error("Unsupported source file type")
    if (info.size > limit) throw new Error("Package file limit exceeded")
    return await boundedRead(file.createReadStream({ autoClose: false }), limit)
  } finally { await file.close() }
}
function makeCollector(limits: ReturnType<typeof limitsFor>) {
  const files = new Map<string, Buffer>(), seen = new Set<string>(), aliases = new Map<string, string>(); let expanded = 0, entries = 0
  function reserve(path: string) {
    PackagePathSchema.parse(path)
    const parts = path.split("/")
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join("/"), folded = prefix.toLowerCase()
      if (aliases.has(folded) && aliases.get(folded) !== prefix) throw new Error("duplicate archive path alias")
      aliases.set(folded, prefix)
    }
    const canonical = path.toLowerCase()
    if (seen.has(canonical)) throw new Error("duplicate archive path")
    seen.add(canonical)
    if (++entries > limits.entries) throw new Error("Package entry limit exceeded")
  }
  function add(path: string, data: Buffer) {
    if (data.length > limits.fileBytes || (expanded += data.length) > limits.expandedBytes) throw new Error("Package expansion limit exceeded")
    if (nestedArchive(path, data)) throw new Error("Unsupported nested archive")
    files.set(path, data)
  }
  return { files, reserve, add, remaining: () => limits.expandedBytes - expanded }
}
async function readFolder(path: string, limits: ReturnType<typeof limitsFor>) {
  const root = await realpath(/* turbopackIgnore: true */ path), collector = makeCollector(limits)
  const walk = async (directory: string, prefix: string, depth: number, ancestors: Set<string>): Promise<void> => {
    const canonical = await realpath(/* turbopackIgnore: true */ directory)
    if (canonical !== root && !canonical.startsWith(root + sep)) throw new Error("Symlink escapes consented source root")
    if (ancestors.has(canonical)) throw new Error("Source directory symlink cycle")
    const visited = new Set([...ancestors, canonical])
    if (depth > 64) throw new Error("Package directory depth limit exceeded")
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", ".venv", "__pycache__"].includes(entry.name)) continue
      const relative = prefix + entry.name; collector.reserve(relative)
      const target = join(directory, entry.name), resolved = await realpath(/* turbopackIgnore: true */ target)
      if (resolved !== root && !resolved.startsWith(root + sep)) throw new Error("Symlink escapes consented source root")
      const info = await lstat(resolved)
      if (info.isDirectory()) await walk(resolved, relative + "/", depth + 1, visited)
      else if (info.isFile()) collector.add(relative, await readRegular(resolved, Math.min(limits.fileBytes, collector.remaining())))
      else throw new Error("Unsupported source file type")
    }
  }
  await walk(root, "", 0, new Set())
  return collector.files
}
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
/** Validate the complete central directory (including Unix link modes) before
 * any extraction. ZIP64, multi-disk, encrypted and unknown methods fail closed. */
async function readZip(data: Buffer, limits: ReturnType<typeof limitsFor>) {
  const collector = makeCollector(limits)
  let end = data.length - 22
  while (end >= Math.max(0, data.length - 65557) && data.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0 || end < data.length - 65557 || end + 22 + data.readUInt16LE(end + 20) !== data.length) throw new Error("Invalid ZIP directory")
  const count = data.readUInt16LE(end + 10), directorySize = data.readUInt32LE(end + 12), directory = data.readUInt32LE(end + 16)
  if (data.readUInt16LE(end + 4) || data.readUInt16LE(end + 6) || count !== data.readUInt16LE(end + 8) || count === 65535 || directory + directorySize !== end) throw new Error("Unsupported ZIP layout")
  if (count > limits.entries) throw new Error("Package entry limit exceeded")
  const entries: { path: string; start: number; size: number; expanded: number; crc: number; method: number; link: boolean; directory: boolean }[] = []
  let cursor = directory, expectedLocal = 0
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP entry")
    const flags = data.readUInt16LE(cursor + 8), method = data.readUInt16LE(cursor + 10), crc = data.readUInt32LE(cursor + 16), size = data.readUInt32LE(cursor + 20), expanded = data.readUInt32LE(cursor + 24), n = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32), offset = data.readUInt32LE(cursor + 42)
    if (cursor + 46 + n + extra + comment > end || offset + 30 > directory) throw new Error("Invalid ZIP bounds")
    // Bit 3 data descriptors are supported, but every local range must match.
    if ((flags & ~(0x800 | 8)) !== 0 || ![0, 8].includes(method) || data.readUInt16LE(cursor + 34)) throw new Error("Unsupported ZIP encoding")
    const rawName = data.subarray(cursor + 46, cursor + 46 + n), name = new TextDecoder("utf-8", { fatal: true }).decode(rawName), isDirectory = name.endsWith("/"), path = isDirectory ? name.slice(0, -1) : name
    collector.reserve(path)
    const mode = data.readUInt32LE(cursor + 38) >>> 16, kind = mode & 0xf000
    if (kind && ![0x8000, 0x4000, 0xa000].includes(kind)) throw new Error("Unsupported ZIP file type")
    if (expanded > limits.fileBytes) throw new Error("Package file limit exceeded")
    if (data.readUInt32LE(offset) !== 0x04034b50 || offset !== expectedLocal || data.readUInt16LE(offset + 6) !== flags || data.readUInt16LE(offset + 8) !== method) throw new Error("ZIP local directory mismatch")
    const ln = data.readUInt16LE(offset + 26), le = data.readUInt16LE(offset + 28), start = offset + 30 + ln + le
    if (start + size > directory || !rawName.equals(data.subarray(offset + 30, offset + 30 + ln))) throw new Error("ZIP local directory mismatch")
    if (!(flags & 8) && (data.readUInt32LE(offset + 14) !== crc || data.readUInt32LE(offset + 18) !== size || data.readUInt32LE(offset + 22) !== expanded)) throw new Error("ZIP local size mismatch")
    expectedLocal = start + size
    if (flags & 8) {
      if (expectedLocal + 12 > directory) throw new Error("Invalid ZIP descriptor")
      if (data.readUInt32LE(expectedLocal) === 0x08074b50) expectedLocal += 4
      if (expectedLocal + 12 > directory || data.readUInt32LE(expectedLocal) !== crc || data.readUInt32LE(expectedLocal + 4) !== size || data.readUInt32LE(expectedLocal + 8) !== expanded) throw new Error("ZIP descriptor mismatch")
      expectedLocal += 12
    }
    entries.push({ path, start, size, expanded, crc, method, link: kind === 0xa000, directory: isDirectory })
    cursor += 46 + n + extra + comment
  }
  if (cursor !== end || expectedLocal !== directory) throw new Error("Invalid ZIP layout")
  const links = new Map<string, string>()
  for (const entry of entries) {
    const compressed = data.subarray(entry.start, entry.start + entry.size)
    let bytes: Buffer
    if (entry.method === 0) bytes = compressed
    else {
      const inflater = createInflateRaw({ chunkSize: 16384 })
      const input = Readable.from((function* () { for (let i = 0; i < compressed.length; i += 16384) yield compressed.subarray(i, i + 16384) })())
      input.pipe(inflater)
      try { bytes = await boundedRead(inflater, Math.min(limits.fileBytes, collector.remaining())) }
      finally { input.destroy(); inflater.destroy() }
    }
    if (bytes.length !== entry.expanded || crc32(bytes) !== entry.crc) throw new Error("ZIP content integrity mismatch")
    if (entry.directory) { if (bytes.length) throw new Error("Invalid ZIP directory content"); continue }
    if (entry.link) {
      const target = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      if (!target || /[\\:\x00-\x1f]/.test(target) || posix.isAbsolute(target)) throw new Error("Invalid archive path symlink")
      const resolved = posix.normalize(posix.join(posix.dirname(entry.path), target))
      if (resolved !== ".") PackagePathSchema.parse(resolved)
      links.set(entry.path, resolved)
    } else collector.add(entry.path, bytes)
  }
  // Freeze originals before expanding aliases. Otherwise a link to an ancestor
  // could discover its own just-created descendants and grow without bound.
  const originals = new Map(collector.files), originalPaths = [...originals.keys(), ...links.keys()]
  const directories = new Set(entries.filter((entry) => entry.directory).map((entry) => entry.path))
  function* resolveContent(path: string, seen: Set<string>): Generator<{ suffix: string; bytes: Buffer }> {
    if (seen.has(path) || seen.size > 64) throw new Error("Archive symlink cycle")
    const visited = new Set([...seen, path]), regular = originals.get(path)
    if (regular) { yield { suffix: "", bytes: regular }; return }
    const target = links.get(path)
    if (target !== undefined) { yield* resolveContent(target, visited); return }
    const parts = path.split("/")
    for (let i = 1; i < parts.length; i++) {
      const ancestorTarget = links.get(parts.slice(0, i).join("/"))
      if (ancestorTarget !== undefined) {
        yield* resolveContent(posix.join(ancestorTarget, ...parts.slice(i)), visited)
        return
      }
    }
    const prefix = path === "." ? "" : path + "/"
    const children = new Set(originalPaths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]))
    if (!children.size && !directories.has(path)) throw new Error("Archive symlink target is missing")
    for (const child of children) {
      for (const content of resolveContent(prefix + child, visited)) yield { suffix: child + (content.suffix ? "/" + content.suffix : ""), bytes: content.bytes }
    }
  }
  for (const path of links.keys()) {
    for (const content of resolveContent(path, new Set())) {
      const destination = content.suffix ? path + "/" + content.suffix : path
      if (content.suffix) collector.reserve(destination)
      collector.add(destination, content.bytes)
    }
  }
  return collector.files
}
function publicAddress(address: string) {
  // Use public IPv4 only. IPv6-only hosts fail explicitly until that transport is supported.
  if (isIP(address) !== 4) return false
  const [a, b] = address.split(".").map(Number)
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0))
}
async function pinnedRequest(url: URL, address: { address: string; family: number }, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, family: 4, lookup: (_host, _options, callback) => callback(null, address.address, address.family), signal: AbortSignal.timeout(30000) }, (res) => {
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value)
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status: res.statusCode!, headers: responseHeaders }))
    })
    req.on("error", () => reject(new Error("GitHub acquisition request failed"))); req.end()
  })
}
async function githubRequest(initial: URL, options: AcquisitionOptions, archive = false): Promise<Response> {
  let url = initial
  // Only archive redirects may carry a bounded transient signature query. It
  // never becomes source/provenance data or an API Authorization credential.
  for (let hop = 0; hop <= 4; hop++) {
    if (url.protocol !== "https:" || !["api.github.com", "codeload.github.com"].includes(url.hostname) || url.port || url.username || url.password || url.hash || url.href.length > 12000) throw new Error("Unsafe GitHub redirect destination")
    if (url.search && (!archive || hop === 0 || url.hostname !== "codeload.github.com" || url.search.length > 8192 || [...url.searchParams].length > 32)) throw new Error("Unsafe GitHub redirect query")
    let addresses: { address: string; family: number }[]
    try { addresses = await (options.resolveHost ?? ((host) => lookup(host, { all: true, family: 4 })))(url.hostname) }
    catch { throw new Error("GitHub destination could not be resolved") }
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error("Private or unsupported network destination")
    const headers: Record<string, string> = { "User-Agent": "SciSpark-Package-Inspector", Accept: "application/vnd.github+json" }
    let token: string | undefined
    try { token = url.hostname === "api.github.com" ? await options.githubToken?.() : undefined }
    catch { throw new ImportNeedsSetupError("GitHub credentials are unavailable") }
    if (token) headers.Authorization = `Bearer ${token}`
    let response: Response
    try { response = await (options.request ?? pinnedRequest)(url, addresses[0], headers) }
    catch { throw new Error("GitHub acquisition request failed") }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined); const location = response.headers.get("location")
      if (!location || hop === 4) throw new Error("GitHub redirect limit exceeded")
      if (location.length > 12000) throw new Error("Unsafe GitHub redirect destination")
      try { url = new URL(location, url) } catch { throw new Error("Invalid GitHub redirect destination") }
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      if ([401, 403, 404].includes(response.status)) throw new ImportNeedsSetupError("GitHub repository access needs setup or a valid repository selection")
      throw new Error(`GitHub acquisition failed (${response.status})`)
    }
    return response
  }
  throw new Error("GitHub redirect limit exceeded")
}
async function responseBytes(response: Response, limit: number) {
  if (!response.body) throw new Error("Empty GitHub response")
  try { return await boundedRead(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), limit) }
  catch (error) {
    if (error instanceof Error && error.message === "Package size limit exceeded") throw error
    throw new Error("GitHub response body could not be read")
  }
}

/** Acquisition only copies bytes from an explicit source. It cannot execute hooks,
 * submodules, validators, skill instructions or installation commands. */
export async function acquirePackage(ctx: WorkflowContext, input: ImportSource, options: AcquisitionOptions = {}): Promise<StagedPackage> {
  const source = ImportSourceSchema.parse(input), limits = limitsFor(options)
  let files: Map<string, Buffer>, locator: string, revision: string
  if (source.kind === "github") {
    const repo = new URL(source.url).pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.git$/, "").toLowerCase()
    locator = `https://github.com/${repo}`
    const response = await githubRequest(new URL(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(source.ref ?? "HEAD")}`), options)
    let commit: unknown
    try { commit = JSON.parse((await responseBytes(response, 1024 * 1024)).toString()) }
    catch { throw new Error("GitHub commit response could not be read") }
    const sha = typeof commit === "object" && commit !== null && "sha" in commit ? commit.sha : null
    if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha)) throw new Error("GitHub did not resolve an immutable commit")
    revision = sha
    const archive = await githubRequest(new URL(`https://api.github.com/repos/${repo}/zipball/${sha}`), options, true)
    files = await readZip(await responseBytes(archive, limits.compressedBytes), limits)
    const prefixes = new Set([...files.keys()].map((p) => p.split("/")[0]))
    if (prefixes.size !== 1 || [...files.keys()].some((p) => !p.includes("/"))) throw new Error("Invalid GitHub archive root")
    files = new Map([...files].map(([path, bytes]) => [path.slice(path.indexOf("/") + 1), bytes]))
  } else {
    locator = await realpath(/* turbopackIgnore: true */ source.path)
    files = source.kind === "zip" ? await readZip(await readRegular(locator, limits.compressedBytes), limits) : await readFolder(locator, limits)
    revision = sha256(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, sha256(bytes)])))
  }
  const stage = await persistAcquiredFiles(ctx, files, locator, revision, source.kind === "github" ? "github" : source.kind === "agent" ? "agent" : "local", source.packageId)
  await saveUpdateSource(ctx, stage.id, { source: source.kind === "github" ? { ...source, url: locator } : { ...source, path: locator }, locator })
  return stage
}

/** Discovery supplies an already bounded, consent-filtered inert snapshot.
 * Reuse normal import path/size/archive validation and persistence. */
export async function acquireAgentSnapshot(ctx: WorkflowContext, input: Map<string, Buffer>, locator: string, discoveryGrantId: string): Promise<StagedPackage> {
  const collector = makeCollector(limitsFor({}))
  for (const [path, bytes] of input) { collector.reserve(path); collector.add(path, bytes) }
  const revision = sha256(JSON.stringify([...collector.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, sha256(bytes)])))
  return persistAcquiredFiles(ctx, collector.files, locator, revision, "agent", undefined, discoveryGrantId)
}
async function persistAcquiredFiles(ctx: WorkflowContext, files: Map<string, Buffer>, locator: string, revision: string, source: "github" | "agent" | "local", packageId?: string, discoveryGrantId?: string): Promise<StagedPackage> {
  const storage = await importStorage(ctx)
  if (!files.size) throw new Error("Package contains no files")
  const id = randomUUID(), origin = sha256(locator).slice(0, 32)
  const stage = StagedPackageSchema.parse({ schemaVersion: 1, id, profileId: ctx.profileId, vaultId: ctx.vaultId, packageId: `import.${origin}${packageId ? "." + packageId : ""}`, version: revision, ...(discoveryGrantId ? { discoveryGrantId } : {}),
    provenance: { source, locator, revision },
    files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({ path, sha256: sha256(bytes), bytes: bytes.length })) })
  try {
    for (const [path, bytes] of files) await storage.writeBinary(`imports/${id}/files/${path}`, bytes)
    await storage.write(`imports/${id}/stage.json`, JSON.stringify(stage))
    return stage
  } catch (error) {
    // Only the host-allocated new stage is removed on failure.
    await rm(join(profileRuntimePath(ctx), "imports", id), { recursive: true, force: true })
    throw error
  }
}

/** Source records are private and never authorize an automatic filesystem read. */
export async function saveUpdateSource(ctx: WorkflowContext, stageId: string, source: unknown) {
  const storage = await importStorage(ctx)
  await storage.write(`imports/${StagedPackageSchema.shape.id.parse(stageId)}/update-source.json`, JSON.stringify(UpdateSourceSchema.parse(source)))
}
export async function acquireUpdateSnapshot(ctx: WorkflowContext, files: Map<string, Buffer>, input: unknown, grantId: string) {
  const origin = UpdateSourceSchema.parse(input)
  if (origin.source.kind === "github" || origin.source.kind === "zip") throw new Error("Expected a consented package folder")
  const collector = makeCollector(limitsFor({}))
  for (const [path, bytes] of files) { collector.reserve(path); collector.add(path, bytes) }
  const revision = sha256(JSON.stringify([...collector.files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, sha256(bytes)])))
  const stage = await persistAcquiredFiles(ctx, collector.files, origin.locator, revision, origin.source.kind === "agent" ? "agent" : "local", origin.source.packageId, grantId)
  await saveUpdateSource(ctx, stage.id, origin)
  return stage
}
/** Reuses the bounded, pinned public HTTPS transport; never downloads an archive. */
export async function checkGithubRevision(input: ImportSource, options: AcquisitionOptions = {}): Promise<string> {
  const source = ImportSourceSchema.parse(input)
  if (source.kind !== "github") throw new Error("Expected an approved GitHub origin")
  const repo = new URL(source.url).pathname.replace(/^\//, "").replace(/\/$/, "").replace(/\.git$/, "").toLowerCase()
  const response = await githubRequest(new URL(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(source.ref ?? "HEAD")}`), options)
  const commit: unknown = JSON.parse((await responseBytes(response, 1024 * 1024)).toString())
  if (!commit || typeof commit !== "object" || !("sha" in commit) || typeof commit.sha !== "string" || !/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error("GitHub did not resolve an immutable commit")
  return commit.sha
}
