import { mkdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { posix } from "node:path"
import { z } from "zod"
import { parse as parseYaml } from "yaml"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import type { WorkflowContext } from "../workflows/context"
import { ToolManifestSchema, ToolRefSchema, UuidSchema, toolKey, type ToolRef } from "./contracts"
import { AdapterProposalSchema, ImportPreviewSchema, UpdateSourceSchema, ApprovedUpdateSourceSchema, PackagePathSchema, StagedPackageSchema, type AdapterProposal, type ImportPreview, type StagedPackage } from "./import-contract"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"
import { exactRef, resolveDependencies } from "./dependencies"
import { sha256 } from "./acquire"
import { canonicalJSON, extensionObjectPath, importStorage, ImportedSnapshotSchema, readImportedManifests, recordImportedRefs, requireDiscoveryGrant, snapshotDigest, updateProfileTools, withDiscoveryGrant } from "./store"

const METADATA = /(?:^|\/)(?:\.agents\/plugins\/marketplace\.json|\.claude-plugin\/marketplace\.json|\.codex-plugin\/plugin\.json|\.claude-plugin\/plugin\.json)$/
const EMPTY_SETUP = { commands: [], runtimes: [], unsupported: [] }
function boundedValue(value: unknown, depth = 0, state = { nodes: 0 }): void {
  if (value !== null && !["string", "number", "boolean", "object"].includes(typeof value)) throw new Error("Expected JSON data only")
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Expected finite JSON number")
  if (value && typeof value === "object" && !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Expected plain JSON object")
  if (depth > 24) throw new Error("Schema depth limit exceeded")
  if (++state.nodes > 10000) throw new Error("Schema size limit exceeded")
  if (Array.isArray(value)) for (const item of value) boundedValue(item, depth + 1, state)
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsupported schema property")
    boundedValue(item, depth + 1, state)
  }
}
/** Conservative JSON Schema subset. No refs, regex, custom validators or
 * schema-dependent code execution. Zod is the sole validator implementation. */
export function validateInputSchema(schema: Record<string, unknown>) {
  boundedValue(schema)
  if (JSON.stringify(schema).length > 64000) throw new Error("Schema size limit exceeded")
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum", "const", "description", "title", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "anyOf", "allOf", "oneOf"])
  const walk = (node: unknown): void => {
    if (typeof node === "boolean") return
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("Invalid JSON schema")
    for (const [key, value] of Object.entries(node)) {
      if (!allowed.has(key)) throw new Error(`Unsupported schema construct: ${key}`)
      if (key === "properties") { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid schema properties"); Object.values(value).forEach(walk) }
      if (["items", "additionalProperties"].includes(key)) walk(value)
      if (["anyOf", "allOf", "oneOf"].includes(key)) { if (!Array.isArray(value) || value.length > 30) throw new Error("Invalid schema composition"); value.forEach(walk) }
    }
  }
  walk(schema)
  return z.fromJSONSchema(schema)
}
function parseMetadata(raw: string): Record<string, unknown> {
  if (raw.length > 1024 * 1024) throw new Error("Metadata size limit exceeded")
  const value: unknown = JSON.parse(raw); boundedValue(value)
  return z.record(z.string(), z.unknown()).parse(value)
}
async function readStage(ctx: WorkflowContext, id: string): Promise<StagedPackage> {
  UuidSchema.parse(id)
  const storage = await importStorage(ctx)
  if (await storage.hasSymlinkTraversal(`imports/${id}/stage.json`)) throw new Error("Import stage symlink traversal")
  const raw = await storage.read(`imports/${id}/stage.json`)
  if (!raw) throw new Error("Import stage not found for this profile")
  const stage = StagedPackageSchema.parse(JSON.parse(raw))
  if (stage.id !== id || stage.profileId !== ctx.profileId || stage.vaultId !== ctx.vaultId) throw new Error("Import stage ownership mismatch")
  if (stage.discoveryGrantId) await requireDiscoveryGrant(ctx, stage.discoveryGrantId)
  return stage
}
async function stageBytes(ctx: WorkflowContext, stage: StagedPackage, path: string): Promise<Uint8Array> {
  const record = stage.files.find((f) => f.path === path)
  if (!record) throw new Error(`Required resource is missing: ${path}`)
  const storage = await importStorage(ctx), relative = `imports/${stage.id}/files/${PackagePathSchema.parse(path)}`
  if (await storage.hasSymlinkTraversal(relative)) throw new Error("Import stage symlink traversal")
  const data = await storage.readBinary(relative)
  if (!data || data.length !== record.bytes || sha256(data) !== record.sha256) throw new Error("Staged package integrity mismatch")
  return data
}
function referencePath(from: string, target: string): string | null {
  if (/^(?:https?:|mailto:|#)/i.test(target)) return null
  const withoutFragment = target.split(/[?#]/)[0]
  if (!withoutFragment) return null
  let decoded: string
  try { decoded = decodeURIComponent(withoutFragment) } catch { throw new Error("Invalid resource path encoding") }
  if (decoded.startsWith("/") || /[\\:]/.test(decoded)) throw new Error("Invalid archive path resource")
  return PackagePathSchema.parse(posix.normalize(posix.join(posix.dirname(from), decoded)))
}
/** Bounded reference-link subset. Definitions with unsupported syntax fail
 * inspection instead of silently losing a required file from the snapshot. */
function markdownFenceMarker(line: string, fenced: boolean) {
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
  // A backtick fence's info string cannot contain another backtick. Reject this
  // unsupported form rather than hiding genuine prose/resource links to EOF.
  if (!fenced && marker?.[1][0] === "`" && line.slice(marker[0].length).includes("`")) throw new Error("Invalid Markdown backtick fence")
  return marker
}
function markdownProse(text: string): string {
  let fence: { char: string; length: number } | undefined
  const lines = text.split(/\r?\n/).map(line => {
    const marker = markdownFenceMarker(line, !!fence)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && line.slice(marker[0].length).trim() === "") fence = undefined
      return ""
    }
    return fence ? "" : line
  }).join("\n")
  // Pair exact-length runs in linear time. Outside code, an odd backslash run
  // escapes the opening delimiter; inside code, backslashes are literal content.
  const runs = [...lines.matchAll(/`+/g)], next = new Map<number, number>(), matching: Array<number | undefined> = []
  for (let i = runs.length - 1; i >= 0; i--) { matching[i] = next.get(runs[i][0].length); next.set(runs[i][0].length, i) }
  let cursor = 0, prose = ""
  for (let i = 0; i < runs.length; i++) {
    const start = runs[i].index!
    let slashes = 0
    for (let j = start - 1; j >= 0 && lines[j] === "\\"; j--) slashes++
    if (slashes % 2 && runs[i][0].length > 1) throw new Error("Unsupported escaped Markdown backtick run")
    const close = matching[i]
    if (slashes % 2 || close === undefined) continue
    prose += lines.slice(cursor, start)
    cursor = runs[close].index! + runs[close][0].length
    i = close
  }
  return prose + lines.slice(cursor)
}
function markdownReferenceTargets(text: string): string[] {
  const definitions = new Map<string, string>(), body: string[] = []
  const label = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase().toLowerCase()
  let fence: { char: string; length: number } | undefined
  for (const line of text.split(/\r?\n/)) {
    const marker = markdownFenceMarker(line, !!fence)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && line.slice(marker[0].length).trim() === "") fence = undefined
      body.push(""); continue
    }
    if (fence) { body.push(""); continue }
    if (markdownProse(line).includes("]:")) {
      const definition = /^ {0,3}\[([^\[\]\\]{1,999})\]:[ \t]*(?:<([^>\r\n]+)>|(\S+?))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/.exec(line)
      if (!definition) throw new Error("Unsupported Markdown reference definition; use a simple single-line destination")
      if (definition[1].includes("`") || /&(?:#\w+|[A-Za-z]+);/.test(definition[2] ?? definition[3])) throw new Error("Unsupported Markdown reference escaping")
      const key = label(definition[1])
      if (!key || definitions.size >= 10000) throw new Error("Markdown reference limit exceeded")
      if (!definitions.has(key)) definitions.set(key, definition[2] ?? definition[3])
      body.push(""); continue
    }
    body.push(line)
  }
  if (!definitions.size) return []
  // Code examples are not references. Other nested/escaped bracket forms are
  // explicitly unsupported by this bounded parser, not treated as resolved.
  const rawProse = body.join("\n")
  if (rawProse.includes("``")) throw new Error("Unsupported Markdown reference code delimiter")
  const prose = markdownProse(rawProse)
  const targets: string[] = []
  const readLabel = (start: number) => {
    let end = start + 1
    for (; end < prose.length && prose[end] !== "]"; end++) {
      if (prose[end] === "[" || prose[end] === "\\") throw new Error("Unsupported Markdown reference label")
      if (end - start > 999) throw new Error("Markdown reference label limit exceeded")
    }
    return { value: prose.slice(start + 1, end), end }
  }
  for (let i = 0; i < prose.length; i++) {
    if (prose[i] === "\\") { i++; continue }
    if (prose[i] !== "[") continue
    const first = readLabel(i)
    i = first.end
    if (i >= prose.length || prose[i + 1] === "(") continue
    // A full/collapsed reference requires an immediately adjacent label.
    // Whitespace leaves separate shortcut uses, including across paragraphs.
    const next = i + 1
    let key = label(first.value)
    if (prose[next] === "[") {
      const second = readLabel(next)
      if (second.end >= prose.length) throw new Error("Unsupported Markdown reference label")
      key = label(second.value || first.value); i = second.end
    }
    const target = definitions.get(key) ?? definitions.get(label(first.value))
    if (target) targets.push(target)
    if (targets.length > 10000) throw new Error("Markdown reference limit exceeded")
  }
  return targets
}
async function closure(ctx: WorkflowContext, stage: StagedPackage, proposal: AdapterProposal) {
  const needed = new Set<string>(), pending: string[] = []
  const add = (path: string) => {
    if (needed.has(path)) return
    if (needed.size >= 10000) throw new Error("Resource closure limit exceeded")
    if (!stage.files.some((f) => f.path === path)) {
      const directory = stage.files.filter((f) => f.path.startsWith(path.replace(/\/$/, "") + "/"))
      if (!directory.length) throw new Error(`Required resource is missing: ${path}`)
      directory.forEach((f) => add(f.path)); return
    }
    needed.add(path); pending.push(path)
  }
  add(proposal.entrypoint); proposal.resources.forEach(add)
  proposal.executionCommands?.forEach(command => add(command.entrypoint))
  if (proposal.setup.environment) {
    add(proposal.setup.environment.lockFile)
    if (proposal.setup.environment.runtime === "node22") add("package.json")
  }
  const entryDirectory = posix.dirname(proposal.entrypoint)
  for (const file of stage.files) {
    // Notices travel with every selected closure, including ancestor licenses.
    if (/(?:^|\/)(LICENSE|LICENCE|NOTICE|COPYING)(?:[.-][^/]*)?$/i.test(file.path)) add(file.path)
    const prefix = entryDirectory === "." ? "" : entryDirectory + "/"
    if (["references/", "resources/", "assets/", "scripts/"].some((folder) => file.path.startsWith(prefix + folder))) add(file.path)
  }
  while (pending.length) {
    const path = pending.pop()!
    if (!/\.(md|markdown|txt|json|ya?ml)$/i.test(path)) continue
    const bytes = await stageBytes(ctx, stage, path)
    if (bytes.length > 1024 * 1024) {
      if (/\.(md|markdown)$/i.test(path)) throw new Error("Markdown resource exceeds bounded reference inspection limit")
      continue // Non-Markdown large resources stay intact for paged context.
    }
    const text = new TextDecoder().decode(bytes)
    if (/\.(md|markdown)$/i.test(path)) for (const destination of markdownReferenceTargets(text)) {
      const target = referencePath(path, destination); if (target) add(target)
    }
    for (const match of (/\.(md|markdown)$/i.test(path) ? markdownProse(text) : text).matchAll(/\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g)) {
      const target = referencePath(path, match[1]); if (target) add(target)
    }
    // Inline code often names required scripts/resources. Only copy existing
    // paths; prose is never interpreted as a shell command or install recipe.
    for (const match of text.matchAll(/`([^`\s]+\.[A-Za-z0-9]+)`/g)) {
      if (/^[./\w-]+$/.test(match[1])) { const target = referencePath(path, match[1]); if (target && stage.files.some((f) => f.path === target)) add(target) }
    }
  }
  return stage.files.filter((f) => needed.has(f.path))
}
async function buildTool(ctx: WorkflowContext, stage: StagedPackage, input: AdapterProposal, inferred: boolean, reviewed: boolean, hostUnsupported: string[]): Promise<ImportPreview["tools"][number]> {
  boundedValue(input.inputSchema)
  const proposal = AdapterProposalSchema.parse(input); validateInputSchema(proposal.inputSchema)
  if (new Set(proposal.dependencySlots.map((slot) => slot.id)).size !== proposal.dependencySlots.length) throw new Error("Duplicate dependency slot")
  if (new Set(proposal.executionCommands?.map(command => command.id)).size !== (proposal.executionCommands?.length ?? 0)) throw new Error("Duplicate execution command")
  const files = await closure(ctx, stage, proposal)
  // Host detections cannot be cleared by package metadata or review edits.
  // No host-validated resolution exists in this inspection-only phase.
  const requirements = { ...proposal.setup, unsupported: [...new Set([...hostUnsupported, ...proposal.setup.unsupported])] }
  const reasons = [...requirements.unsupported]
  if (proposal.kind === "command" || proposal.setup.commands.length || proposal.setup.runtimes.length) reasons.push("Command isolation and dependency setup are not available in package inspection")
  const compatibility: ImportPreview["tools"][number]["compatibility"] = !reviewed ? { status: "needs-review", reasons: ["Review capabilities, resources and setup plan", ...requirements.unsupported] } : reasons.length ? { status: "unsupported", reasons } : proposal.connections.length ? { status: "needs-setup", reasons: ["Required connections need setup"] } : { status: "ready", reasons: [] }
  const manifest = ToolManifestSchema.parse({ ref: { packageId: stage.packageId, skillId: proposal.skillId, version: stage.version, digest: "0".repeat(64) }, name: proposal.name, description: proposal.description, kind: proposal.kind, entrypoint: proposal.entrypoint, dependencies: proposal.dependencies, resources: proposal.resources, capabilities: proposal.capabilities, connections: proposal.connections, engines: proposal.engines, inputSchema: proposal.inputSchema, outputKinds: proposal.outputKinds, provenance: stage.provenance })
  const tool = { manifest, proposal, inferred, reviewed, hostUnsupported: [...new Set(hostUnsupported)], compatibility, requirements, files }
  manifest.ref.digest = snapshotDigest(tool)
  return tool
}
async function savePreview(ctx: WorkflowContext, preview: ImportPreview, grantId?: string, inspectedProposals?: AdapterProposal[]) {
  const parsed = ImportPreviewSchema.parse(preview), storage = await importStorage(ctx)
  if (JSON.stringify(parsed).length > 16 * 1024 * 1024) throw new Error("Import preview size limit exceeded")
  if (grantId) await requireDiscoveryGrant(ctx, grantId)
  await storage.write(`imports/proposal-baselines/${parsed.id}.json`, JSON.stringify(z.array(AdapterProposalSchema).parse(inspectedProposals ?? parsed.tools.map(tool => tool.proposal))))
  if (grantId) await requireDiscoveryGrant(ctx, grantId)
  await storage.write(`imports/previews/${parsed.id}.json`, JSON.stringify(parsed)); return parsed
}
export async function readImportPreview(ctx: WorkflowContext, id: string) {
  UuidSchema.parse(id)
  const storage = await importStorage(ctx)
  if (await storage.hasSymlinkTraversal(`imports/previews/${id}.json`)) throw new Error("Import preview symlink traversal")
  const raw = await storage.read(`imports/previews/${id}.json`)
  if (!raw) throw new Error("Import preview not found for this profile")
  const preview = ImportPreviewSchema.parse(JSON.parse(raw))
  if (preview.id !== id || preview.profileId !== ctx.profileId || preview.vaultId !== ctx.vaultId) throw new Error("Import preview ownership mismatch")
  return preview
}
export async function inspectPackage(ctx: WorkflowContext, candidate: StagedPackage, selectedEntries?: string[]): Promise<ImportPreview> {
  const stage = await readStage(ctx, StagedPackageSchema.parse(candidate).id)
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async () => {
    const metadata = stage.files.filter((f) => METADATA.test(f.path)), unsupported: string[] = []
    for (const file of metadata) {
      const meta = parseMetadata(new TextDecoder().decode(await stageBytes(ctx, stage, file.path)))
      // Recognize metadata without executing hooks or acquiring nested sources.
      for (const key of ["hooks", "mcpServers", "lspServers", "commands", "dependencies"]) if (meta[key]) unsupported.push(`Plugin ${key} require a reviewed adapter`)
      if (Array.isArray(meta.plugins)) for (const plugin of meta.plugins) {
        if (plugin && typeof plugin === "object" && "source" in plugin) {
          if (typeof plugin.source !== "string" || !plugin.source.startsWith("./")) unsupported.push("External marketplace source requires a separate explicit import")
          else PackagePathSchema.parse(plugin.source.slice(2))
        }
      }
    }
    if (selectedEntries && (!selectedEntries.length || selectedEntries.some(path => !stage.files.some(file => file.path === PackagePathSchema.parse(path) && posix.basename(path) === "SKILL.md")))) throw new Error("Invalid discovered skill entries")
    const entries = stage.files.filter((f) => posix.basename(f.path) === "SKILL.md" && (!selectedEntries || selectedEntries.includes(f.path)))
    const inferred = !entries.length
    if (inferred) entries.push(stage.files.find((f) => /(?:^|\/)README\.md$/i.test(f.path)) ?? stage.files[0])
    if (entries.length > 1000) throw new Error("Tool count limit exceeded")
    const tools: ImportPreview["tools"] = []
    for (const entry of entries) {
      const text = new TextDecoder().decode(await stageBytes(ctx, stage, entry.path))
      let front: Record<string, unknown> = {}
      if (text.startsWith("---\n")) {
        const end = text.indexOf("\n---", 4)
        if (end < 0 || end > 64000) throw new Error("Invalid bounded skill frontmatter")
        const parsed: unknown = parseYaml(text.slice(4, end), { maxAliasCount: 0, schema: "core" }); boundedValue(parsed)
        front = z.record(z.string(), z.unknown()).parse(parsed)
      }
      const proposed = { skillId: entry.path, name: typeof front.name === "string" ? front.name : inferred ? "Inferred adapter" : posix.basename(posix.dirname(entry.path)), description: typeof front.description === "string" ? front.description : "Review this imported package before use", kind: "instructions", entrypoint: entry.path, capabilities: [], resources: [], dependencies: [], dependencySlots: [], connections: [], engines: [], inputSchema: { type: "object", additionalProperties: false }, outputKinds: ["markdown"], setup: EMPTY_SETUP }
      // An explicit bounded adapter extension is data, and always starts unreviewed.
      const extension = front.scispark
      const proposal = AdapterProposalSchema.parse(extension ? { ...proposed, ...z.record(z.string(), z.unknown()).parse(extension), skillId: entry.path } : proposed)
      tools.push(await buildTool(ctx, stage, proposal, inferred, false, unsupported))
      if (JSON.stringify(tools).length > 16 * 1024 * 1024) throw new Error("Import preview size limit exceeded")
    }
    return savePreview(ctx, { schemaVersion: 1, id: randomUUID(), stageId: stage.id, profileId: ctx.profileId, vaultId: ctx.vaultId, tools, recognizedMetadata: [...metadata.map((m) => m.path), ...(!inferred ? entries.map((e) => e.path) : [])], warnings: inferred ? ["No recognized executable skill entry; adapter proposal requires editing and review"] : [] }, stage.discoveryGrantId)
  })
}

/** The user reviews the complete proposal. Return a new immutable preview ID;
 * stale refs cannot authorize modified capabilities or installation commands. */
export async function reviewImport(ctx: WorkflowContext, previewId: string, proposals: AdapterProposal[]): Promise<ImportPreview> {
  return reviseImportPreview(ctx, previewId, proposals, true)
}
/** Recompute a proposed adapter without claiming user review or publishing it. */
export async function reviseImportPreview(ctx: WorkflowContext, previewId: string, proposals: AdapterProposal[], reviewed = false): Promise<ImportPreview> {
  const preview = await readImportPreview(ctx, previewId), stage = await readStage(ctx, preview.stageId)
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async () => {
    if (!proposals.length || proposals.length > preview.tools.length || new Set(proposals.map((p) => p.skillId)).size !== proposals.length) throw new Error("Invalid reviewed tool selection")
    const tools: ImportPreview["tools"] = []
    for (const proposal of proposals) {
      const previous = preview.tools.find((tool) => tool.proposal.skillId === proposal.skillId)
      if (!previous) throw new Error("Unknown adapter proposal")
      tools.push(await buildTool(ctx, stage, proposal, previous.inferred, reviewed, previous.hostUnsupported))
    }
    return savePreview(ctx, { ...preview, id: randomUUID(), tools }, stage.discoveryGrantId, (await readInspectedProposals(ctx, preview.id)) ?? [])
  })
}

export async function commitImport(ctx: WorkflowContext, previewId: string, selected: ToolRef[], options: { prepareCatalogOnly?: boolean } = {}): Promise<ToolRef[]> {
  const refs = z.array(ToolRefSchema).min(1).max(1000).parse(selected)
  const preview = await readImportPreview(ctx, previewId), stage = await readStage(ctx, preview.stageId)
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async (check) => {
    const imports = await readImportedManifests(ctx)
    const byRef = new Map(preview.tools.map((tool) => [exactRef(tool.manifest.ref), tool]))
    if (refs.some((ref) => !byRef.has(exactRef(ref)))) throw new Error("Selection is not part of this import preview")
    const graph = resolveDependencies([...NATIVE_TOOL_MANIFESTS, ...imports, ...preview.tools.map((tool) => tool.manifest)], refs)
    if (graph.status !== "resolved") throw new Error(`Import blocked: ${graph.reason}`)
    const selectedTools = graph.nodes.map((ref) => byRef.get(exactRef(ref))).filter((tool) => tool !== undefined)
    if (selectedTools.some((tool) => !tool.reviewed)) throw new Error("Import requires capability and setup review")
    // Validate every selected closure before publishing any snapshot or binding.
    for (const tool of selectedTools) {
      if (snapshotDigest(tool) !== tool.manifest.ref.digest) throw new Error("Import preview integrity mismatch")
      for (const file of tool.files) await stageBytes(ctx, stage, file.path)
    }
    await check()
    const runtime = new NodeFsVaultStorage(ctx.runtimeRoot)
    for (const tool of selectedTools) {
      const digest = tool.manifest.ref.digest
      await runtime.exclusive(`import-${digest}`, async () => {
        if (await runtime.hasSymlinkTraversal(`objects/${digest}`)) throw new Error("Import object symlink traversal")
        await mkdir(extensionObjectPath(ctx, digest), { recursive: true, mode: 0o700 })
        const object = new NodeFsVaultStorage(extensionObjectPath(ctx, digest))
        const existing = await object.read("snapshot.json")
        const snapshot = ImportedSnapshotSchema.parse({ schemaVersion: 1, tool })
        if (existing && canonicalJSON(JSON.parse(existing)) !== canonicalJSON(snapshot)) throw new Error("Immutable snapshot collision")
        for (const file of tool.files) {
          const path = `files/${file.path}`
          if (await object.hasSymlinkTraversal(path)) throw new Error("Import object symlink traversal")
          const bytes = await object.readBinary(path)
          if (existing) { if (!bytes || sha256(bytes) !== file.sha256) throw new Error("Immutable snapshot content corruption") }
          else await object.writeBinary(path, await stageBytes(ctx, stage, file.path))
        }
        if (!existing) await object.write("snapshot.json", JSON.stringify(snapshot))
      })
    }
    // Snapshot files above are preparation; authorize publication again
    // after those potentially long reads/writes, then hold the grant until both
    // catalog and enabled-binding publication finish. Revoke cannot interleave.
    await check()
    await recordImportedRefs(ctx, graph.nodes.filter((ref) => ref.packageId !== "scispark.builtin"), check)
    const storage = await importStorage(ctx)
    const source = await storage.read(`imports/${stage.id}/update-source.json`)
    if (source) for (const tool of selectedTools) {
      await check()
      const baseline = ((await readInspectedProposals(ctx, preview.id)) ?? []).find(proposal => proposal.skillId === tool.proposal.skillId)
      // A legacy preview without an inspected baseline cannot authorize a merge.
      await check()
      if (baseline) await storage.write(`versions/sources/${tool.manifest.ref.digest}.json`, JSON.stringify(ApprovedUpdateSourceSchema.parse({ ...UpdateSourceSchema.parse(JSON.parse(source)), inspectedProposal: baseline, reviewedProposal: tool.proposal })))
    }
    if (!options.prepareCatalogOnly) await updateProfileTools(ctx, async (current) => {
      // Recheck after waiting for profile-tools and reading its saved state.
      await check()
      const state = current ?? { schemaVersion: 1 as const, enabled: [], pins: [], overrides: [], migrated: false }
      const enabled = new Map(state.enabled.map((binding) => [toolKey(binding.tool), binding]))
      for (const ref of refs) enabled.set(toolKey(ref), { tool: ref, enabled: true })
      return { ...state, enabled: [...enabled.values()], pins: state.pins.map(pin => refs.find(ref => toolKey(ref) === toolKey(pin)) ?? pin) }
    })
    return refs
  })
}

/** Select a discovered candidate without performing the separate human review. */
export async function selectDiscoveredPreview(ctx: WorkflowContext, previewId: string, skillId: string): Promise<ImportPreview> {
  const preview = await readImportPreview(ctx, previewId)
  const stage = await readStage(ctx, preview.stageId)
  return withDiscoveryGrant(ctx, stage.discoveryGrantId, async () => {
    const tool = preview.tools.find(tool => tool.proposal.skillId === skillId)
    if (!tool) throw new Error("Unknown discovery candidate")
    return savePreview(ctx, { ...preview, id: randomUUID(), tools: [tool] }, stage.discoveryGrantId, (await readInspectedProposals(ctx, preview.id)) ?? [])
  })
}

async function readInspectedProposals(ctx: WorkflowContext, previewId: string): Promise<AdapterProposal[] | undefined> {
  const raw = await (await importStorage(ctx)).read(`imports/proposal-baselines/${UuidSchema.parse(previewId)}.json`)
  return raw ? z.array(AdapterProposalSchema).parse(JSON.parse(raw)) : undefined
}
