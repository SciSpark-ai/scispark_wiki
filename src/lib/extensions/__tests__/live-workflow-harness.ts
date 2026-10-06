/** Test-owned live acceptance configuration. No production feature flag or credential persistence. */
import { z } from "zod"
import { isAbsolute, join } from "node:path"
import { mkdir, readFile, realpath, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { DEFAULT_SETTINGS, type LLMSettings } from "../../llm/settings"
import { DEFAULT_ENGINES } from "../../engines/contracts"
import { DEFAULT_RUN_ALLOWANCE, type ToolRun } from "../../workflows/contracts"
import { captureCatalogPrice } from "../../workflows/model"
import { readArtifact } from "../../workflows/artifacts"
import { canonicalJson } from "../../workflows/journal"

const Configuration = z.object({ mode: z.enum(["source", "provider"]), evalRoot: z.string(), engine: z.enum(["api", "codex", "claude-code"]), provider: z.enum(["openai", "anthropic", "google", "openrouter"]), model: z.string(), maxCalls: z.number().int().nonnegative().safe(), maxUsd: z.number().finite().positive().nullable() }).strict()
export type Configuration = z.infer<typeof Configuration>
export function acceptanceConfiguration(env: Record<string, string | undefined>, mode: Configuration["mode"]): Configuration {
  if (["SCISPARK_VAULT", "SCISPARK_PROFILE_REGISTRY_ROOT", "SCISPARK_PROFILES_DIR", "SCISPARK_VAULT_PATH"].some(k => env[k])) throw new Error("Live workflow gates reject normal vault/profile overrides")
  if (env[mode === "source" ? "SCISPARK_TOOL_SOURCE_SMOKE" : "SCISPARK_TOOL_LIVE_APPROVED"] !== "1") throw new Error("Explicit acceptance authorization is required")
  if (!env.SCISPARK_TOOL_EVAL_ROOT || !isAbsolute(env.SCISPARK_TOOL_EVAL_ROOT)) throw new Error("Explicit disposable SCISPARK_TOOL_EVAL_ROOT is required")
  if (mode === "source") return Configuration.parse({ mode, evalRoot: env.SCISPARK_TOOL_EVAL_ROOT, engine: "codex", provider: "openai", model: "source-only-no-model", maxCalls: 0, maxUsd: null })
  const engine = z.enum(["api", "codex", "claude-code"]).parse(env.SCISPARK_TOOL_LIVE_ENGINE)
  const provider = engine === "api" ? z.enum(["openai", "anthropic", "google", "openrouter"]).parse(env.SCISPARK_TOOL_LIVE_PROVIDER) : engine === "codex" ? "openai" : "anthropic"
  const model = z.string().min(1).max(150).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/).parse(env.SCISPARK_TOOL_LIVE_MODEL)
  if (!env.SCISPARK_TOOL_LIVE_MAX_CALLS?.match(/^[1-9][0-9]*$/)) throw new Error("Explicit positive SCISPARK_TOOL_LIVE_MAX_CALLS is required")
  const maxUsd = engine === "api" ? Number(env.SCISPARK_TOOL_LIVE_MAX_USD) : null
  const config = Configuration.parse({ mode, evalRoot: env.SCISPARK_TOOL_EVAL_ROOT, engine, provider, model, maxCalls: Number(env.SCISPARK_TOOL_LIVE_MAX_CALLS), maxUsd })
  if (engine === "api" && !captureCatalogPrice({ provider, model })) throw new Error("Selected API model requires an existing exact scoped price")
  return config
}
export function acceptanceAllowance(config: Configuration) { return { ...DEFAULT_RUN_ALLOWANCE, modelCalls: config.maxCalls, costUsd: config.maxUsd } }
export function acceptanceSettings(config: Configuration): LLMSettings {
  return { ...DEFAULT_SETTINGS, keys: {}, dailyBudgetUsd: config.maxUsd ?? DEFAULT_SETTINGS.dailyBudgetUsd,
    engines: { ...DEFAULT_ENGINES, kind: config.engine, models: { ...DEFAULT_ENGINES.models, ...(config.engine === "api" ? {} : { [config.engine]: { fast: config.model, strong: config.model } }) } },
    tierModels: { fast: { provider: config.provider, model: config.model }, strong: { provider: config.provider, model: config.model } } }
}
export function verifyRetainedRun(run: ToolRun, config: Configuration) {
  if (canonicalJson(run.allowance) !== canonicalJson(acceptanceAllowance(config)) || run.model.engine !== config.engine || Object.values(run.model.tierModels).some(m => m.provider !== config.provider || m.model !== config.model)) throw new Error("Retained acceptance model or allowance mismatch")
}
const Marker = z.object({ schemaVersion: z.literal(1), kind: z.literal("scispark-disposable-tool-acceptance"), base: z.string(), profileId: z.uuid(), operationId: z.uuid(), sourceRunId: z.uuid(), connectionId: z.uuid(), config: Configuration }).strict()
/** Root must be a direct, canonical OS-temp child with a dedicated prefix. Each
 * gate owns a separate marked subdirectory; reruns retain exact model/caps/IDs. */
export async function acceptanceLocation(config: Configuration) {
  const temporaryRoot = await realpath(tmpdir())
  if (!config.evalRoot.startsWith(join(temporaryRoot, "scispark-tool-eval-")) || config.evalRoot.slice(temporaryRoot.length + 1).includes("/")) throw new Error("EVAL_ROOT must be a dedicated direct temporary child")
  await mkdir(config.evalRoot, { recursive: true })
  if (await realpath(config.evalRoot) !== config.evalRoot) throw new Error("EVAL_ROOT cannot be an alias")
  const rootMarkerPath = join(config.evalRoot, "acceptance-root.json")
  try {
    if (await readFile(rootMarkerPath, "utf8") !== JSON.stringify({ kind: "scispark-disposable-tool-evaluation", root: config.evalRoot })) throw new Error("Acceptance root marker mismatch")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    if ((await readdir(config.evalRoot)).length) throw new Error("Unmarked EVAL_ROOT must be empty")
    await writeFile(rootMarkerPath, JSON.stringify({ kind: "scispark-disposable-tool-evaluation", root: config.evalRoot }), { flag: "wx", mode: 0o600 })
  }
  const base = join(config.evalRoot, config.mode)
  await mkdir(base, { recursive: true })
  if (await realpath(base) !== base) throw new Error("Acceptance directory cannot be an alias")
  const markerPath = join(base, "acceptance-marker.json")
  let marker: z.infer<typeof Marker>
  try { marker = Marker.parse(JSON.parse(await readFile(markerPath, "utf8"))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    if ((await readdir(base)).length) throw new Error("Unmarked acceptance directory must be empty")
    marker = Marker.parse({ schemaVersion: 1, kind: "scispark-disposable-tool-acceptance", base, profileId: randomUUID(), operationId: randomUUID(), sourceRunId: randomUUID(), connectionId: randomUUID(), config })
    await writeFile(markerPath, JSON.stringify(marker), { flag: "wx", mode: 0o600 })
  }
  if (marker.base !== base || canonicalJson(marker.config) !== canonicalJson(config)) throw new Error("Retained acceptance configuration mismatch; reuse the original model and caps")
  const vaultPath = join(base, "vault"), runtimeRoot = join(base, "runtime")
  await mkdir(vaultPath, { recursive: true }); await mkdir(runtimeRoot, { recursive: true })
  if (await realpath(vaultPath) !== vaultPath || await realpath(runtimeRoot) !== runtimeRoot) throw new Error("Acceptance paths cannot be aliases")
  return { marker, ctx: { profileId: marker.profileId, vaultId: createHash("sha256").update(vaultPath).digest("hex"), vaultPath, runtimeRoot, storage: new NodeFsVaultStorage(vaultPath) } }
}

export function acceptanceSecrets(env: Record<string, string | undefined>, config: Configuration) {
  const source = env.SCISPARK_TOOL_SOURCE_KEY
  const api = config.mode === "provider" && config.engine === "api" ? env.SCISPARK_TOOL_LIVE_API_KEY : undefined
  const valid = (key: string | undefined) => !!key && key.length <= 2048 && /^[!-~]+$/.test(key)
  if (!valid(source) || config.mode === "provider" && config.engine === "api" && !valid(api)) throw new Error("Explicit in-memory acceptance credentials are required")
  if ([source, api].some(key => key && JSON.stringify(config).includes(key))) throw new Error("Acceptance configuration must not contain credentials")
  return { source: source!, ...(api ? { api } : {}) }
}
/** Read overlay is local to one marked fixture storage instance. No key enters
 * a fixture file, write intent, command argument or provider/model snapshot. */
export class AcceptanceStorage extends NodeFsVaultStorage {
  constructor(root: string, private readonly provider: Configuration["provider"], private readonly secrets: { source: string; api?: string }) { super(root) }
  assertSecretFree(content: string | Uint8Array) {
    const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content)
    if (Object.values(this.secrets).some(secret => secret && bytes.includes(Buffer.from(secret)))) throw new Error("Acceptance secret persistence refused")
  }
  async read(path: string) {
    const raw = await super.read(path)
    if (path !== ".scispark/settings.json") return raw
    let file
    try { file = JSON.parse(raw ?? "{}") } catch { throw new Error("Invalid acceptance settings") }
    return JSON.stringify({ ...file, llm: { ...file.llm, keys: this.secrets.api ? { [this.provider]: this.secrets.api } : {} }, paperSources: { ...file.paperSources, s2: { apiKey: this.secrets.source } } })
  }
  async write(path: string, content: string) { this.assertSecretFree(content); return super.write(path, content) }
  async writeBinary(path: string, content: Uint8Array) { this.assertSecretFree(content); return super.writeBinary(path, content) }
}

const AcceptanceAuditSchema = z.object({ runId: z.uuid(), reviewedBy: z.string().min(1), method: z.literal("human-passage-review"), everyClaimSampled: z.literal(true), reportArtifactId: z.uuid(), reportSha256: z.string(), claims: z.array(z.object({ claim: z.string().min(1), sourceArtifactId: z.uuid(), passage: z.string().min(1), supported: z.literal(true) }).strict()).min(1), comparisonCoverage: z.object({ accuracy: z.enum(["supported", "partial", "unsupported"]), "computational cost": z.enum(["supported", "partial", "unsupported"]), "clinical performance": z.literal("unsupported") }).strict() }).strict()
export async function validateAcceptanceAudit(ctx: import("../../workflows/context").WorkflowContext, run: ToolRun, input: unknown) {
  const audit = AcceptanceAuditSchema.parse(input)
  if (audit.runId !== run.id) throw new Error("Audit root mismatch")
  const report = run.artifacts.find(a => a.id === audit.reportArtifactId)
  if (!report || report.sha256 !== audit.reportSha256) throw new Error("Audit report mismatch")
  const validatedReport = await readArtifact(ctx, run.id, report.id)
  if (validatedReport.metadata.sha256 !== audit.reportSha256) throw new Error("Audit report mismatch")
  const decode = (artifact: Awaited<ReturnType<typeof readArtifact>>) => {
    if (!["text/markdown", "text/plain", "application/json"].includes(artifact.metadata.mediaType)) throw new Error("Audit requires textual evidence")
    return new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes)
  }
  const text = decode(validatedReport)
  for (const claim of audit.claims) {
    if (!text.includes(claim.claim)) throw new Error("Audited claim missing")
    const source = run.artifacts.find(a => a.id === claim.sourceArtifactId && a.sourceRefs.length)
    if (!source) throw new Error("Audited source missing")
    const validatedSource = await readArtifact(ctx, run.id, source.id)
    if (!validatedSource.metadata.sourceRefs.length || !decode(validatedSource).includes(claim.passage)) throw new Error("Audited passage missing")
  }
  if (!text.toLowerCase().includes("clinical")) throw new Error("Clinical comparison limitation missing")
}
