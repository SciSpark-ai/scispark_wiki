import { exportReview } from "../review/report"
import { getRunUsage } from "../workflows/usage"
import { buildProvider } from "../llm/settings"
import { runSkillJob } from "../server/skill-jobs"
import { withLedger } from "../runs/ledger"
import { createHash } from "node:crypto"
import { z } from "zod"
import { askChat, parseAskChatInput } from "../chat/orchestrator"
import { nodeSearchFn, nodeResearchSearchFn, nodeTopWorksFn, nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "../papers/node-search"
import { getSkillTestOverrides } from "../server/skill-route"
import { runResearchSearch } from "../skills/research-search"
import { SeedSchema, runQuickSpark } from "../spark/quick"
import { runDeepSpark } from "../spark/deep"
import { runTrendingBoard } from "../trending/dashboard"
import { maybeAutoRefreshTrending } from "../trending/auto-refresh"
import { createReview, loadReview } from "../review/store"
import { actOnReview, waitForReview, recoverReviewJobs } from "../review/coordinator"
import { ReviewActionSchema, ReviewId } from "../review/contracts"
import { readEnabledPaperSources } from "../papers/source-preferences"
import { registerWorkflowAdapter, HelperInvocationSchema, HelperResultSchema, type WorkflowIO, type HelperInvocation } from "../workflows/adapters"
import type { WorkflowContext } from "../workflows/context"
import type { ToolRun } from "../workflows/contracts"
import { settingsForRunModel } from "../workflows/model"
import { NATIVE_TOOL_MANIFESTS } from "./native-catalog"
import { canonicalJson } from "../workflows/journal"

export const nativePath = (id: string, name: string) => `.scispark/tool-runs/${id}/native-${name}.json`
export const nativeStepId = (frame: string, name: string) => {
  const h = createHash("sha256").update(`${frame}:${name}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const hash = (data: unknown) => createHash("sha256").update(canonicalJson(data)).digest("hex")
const opaque = <T>(io: WorkflowIO, frame: string, name: string, input: unknown, work: () => Promise<T>) => io.step({ id: nativeStepId(frame, name), kind: "read", replay: "reconcile", inputHash: hash(input) }, work)
export const NativeReviewContinuationSchema = z.object({
  reviewId: ReviewId, action: ReviewActionSchema, generation: z.number().int().nonnegative(), operationId: z.string().uuid(), kept: z.literal(true).optional(),
}).strict()
const Direction = z.object({ direction: z.string().trim().min(1).max(10000), clusterPageIds: z.array(z.string()).optional(), seedPageId: z.string().optional() })
const Search = z.object({ query: z.string().trim().min(1), sources: z.array(z.enum(["arxiv", "openalex", "s2", "pubmed"])).optional() })

async function executeReview(ctx: WorkflowContext, root: ToolRun, input: Record<string, unknown>, frame: string, io: WorkflowIO) {
  const raw = await ctx.storage.read(nativePath(root.id, `review-${frame}`))
  let continuation = raw ? NativeReviewContinuationSchema.parse(JSON.parse(raw)) : null
  let reviewId = input.reviewId ? ReviewId.parse(input.reviewId) : root.nativeRunRef?.kind === "deep-review" ? root.nativeRunRef.id : undefined
  if (!reviewId) {
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : root.sessionId ?? frame
    const question = z.string().trim().min(1).parse(input.question ?? input.query)
    const created = await createReview(ctx.storage, { sessionId, operationId: frame, question, sources: input.sources ?? await readEnabledPaperSources(ctx.storage) })
    reviewId = created.id
  } else if (!input.reviewId && !await ctx.storage.read(`.scispark/reviews/${reviewId}/run.json`)) {
    await createReview(ctx.storage, { sessionId: input.sessionId ?? root.sessionId ?? root.operationId, operationId: root.operationId,
      question: z.string().trim().min(1).parse(input.question ?? input.query), sources: input.sources ?? await readEnabledPaperSources(ctx.storage) })
  }
  await recoverReviewJobs(ctx.storage)
  let review = await loadReview(ctx.storage, reviewId)
  if (!review.brief.model.engine && !review.brief.model.rates) {
    await io.emit({ type: "status", status: "waiting_for_setup" })
    return { summary: "Configure prices in the review brief before continuing.", artifactIds: [] }
  }
  if (!continuation) {
    const action = input.action ? ReviewActionSchema.parse(input.action) : { action: "approve" as const, revision: review.revision }
    continuation = NativeReviewContinuationSchema.parse({ reviewId, action, generation: 0, operationId: root.operationId })
    await ctx.storage.write(nativePath(root.id, `review-${frame}`), JSON.stringify(continuation))
  }
  const receipt = nativePath(root.id, `review-dispatched-${frame}-${continuation.generation}`)
  const dispatch = async () => {
    if (await ctx.storage.read(receipt)) return
    io.signal.throwIfAborted()
    // This intent is not replay permission. Native checkpoint/ledger reconciliation
    // handles an interrupted pipeline; an opaque wording revision stays uncertain.
    await ctx.storage.write(receipt, JSON.stringify({ action: continuation!.action }))
    const overrides = getSkillTestOverrides()
    await actOnReview(ctx.storage, reviewId!, continuation!.action, { provider: overrides.providerOverride?.strong, search: overrides.searchFn, fetch: overrides.fetchFn })
    await waitForReview(ctx.storage, reviewId!)
  }
  // Wording revision has no resumable native stage checkpoint. A lost dispatch
  // receipt must remain uncertain rather than publishing its unchanged parent.
  if (continuation.action.action === "revise") await opaque(io, frame, `revision-${continuation.generation}`, continuation.action, async () => { await dispatch(); return true })
  else await dispatch()
  review = await loadReview(ctx.storage, reviewId)
  const version = review.versions.at(-1)
  let artifactIds: string[] = []
  if (version) {
    const artifact = await opaque(io, frame, `report-${version.id}`, version, () => io.publishArtifact({ kind: "markdown", title: review.brief.question, mediaType: "text/markdown", bytes: new TextEncoder().encode(exportReview(review, version, "markdown")), sourceRefs: [`review:${review.id}/${version.id}`, ...(version.evidence ?? review.evidence).map(e => e.locator)] }))
    artifactIds = [artifact.id]
  }
  await ctx.storage.write(nativePath(root.id, `result-${frame}`), JSON.stringify(review))
  if (frame === root.id && review.status !== "completed" && continuation.action.action !== "revise") {
    await io.emit({ type: "choice", id: nativeStepId(frame, `choice-${continuation.generation}`), prompt: "Review work is saved. Resume from its native checkpoints or keep the partial report.", options: [{ id: "retry", label: "Resume review" }, { id: "keep", label: "Keep saved report" }] })
    await io.emit({ type: "status", status: (await getRunUsage(ctx, root.id)).uncertain ? "needs_attention" : "waiting_for_choice" })
  }
  return { summary: version ? "Saved review report with its source-check limitations." : "Review needs input before continuing.", artifactIds }
}

async function executeInvocation(ctx: WorkflowContext, root: ToolRun, skill: string, input: Record<string, unknown>, frame: string, io: WorkflowIO, onProgress?: (event: object) => void) {
  const settings = await settingsForRunModel(ctx, root.model), overrides = getSkillTestOverrides()
  let pending = Promise.resolve()
  const progressEvents: object[] = []
  const progress = (event: object) => { onProgress?.(event); pending = pending.then(async () => { io.signal.throwIfAborted(); progressEvents.push(event); await ctx.storage.write(nativePath(root.id, "progress"), JSON.stringify(progressEvents)); await io.emit({ type: "text", text: JSON.stringify(event) }) }); void pending.catch(() => { /* Awaited on success; native failure remains the primary error. */ }) }
  if (skill === "deep-review") {
    if (!input.reviewId && (typeof (input.question ?? input.query) !== "string" || String(input.question ?? input.query).trim().length < 5)) {
      await io.emit({ type: "choice", id: nativeStepId(frame, "input"), prompt: "Provide a research question for the review.", options: [{ id: "input", label: "Complete review question" }] })
      await io.emit({ type: "status", status: "waiting_for_choice" })
      return { summary: "Provide the review question.", artifactIds: [] }
    }
    try { const provider = overrides.providerOverride?.strong ?? buildProvider(settings, "strong"); await provider.preflight?.(root.model.tierModels.strong.model) }
    catch { await io.emit({ type: "status", status: "waiting_for_setup" }); return { summary: "Connect the captured review model in Settings.", artifactIds: [] } }
    return executeReview(ctx, root, input, frame, io)
  }
  const valid = skill === "idea-spark" ? Direction.safeParse(input).success
    : skill === "find-papers" ? typeof (input.query ?? input.question) === "string" && String(input.query ?? input.question).trim().length > 0
    : input.mode === "auto" || Array.isArray(input.fields)
  if (!valid) {
    await io.emit({ type: "choice", id: nativeStepId(frame, "input"), prompt: "Provide the research question, direction or tracked fields for this tool.", options: [{ id: "input", label: "Complete tool input" }] })
    await io.emit({ type: "status", status: "waiting_for_choice" })
    return { summary: "Complete the tool input before running.", artifactIds: [] }
  }
  if (skill === "idea-spark" || skill === "find-papers") {
    const tier = skill === "find-papers" ? "fast" : "strong"
    try {
      if (root.model.engine === "api" && !root.model.scopedPrices?.[tier]) throw new Error("Captured pricing unavailable")
      const provider = overrides.providerOverride?.[tier] ?? buildProvider(await settingsForRunModel(ctx, root.model, tier), tier); await provider.preflight?.(root.model.tierModels[tier].model) }
    catch {
      await io.emit({ type: "error", code: "waiting_for_setup", message: "Connect the captured AI model in Settings before continuing." })
      await io.emit({ type: "status", status: "waiting_for_setup" })
      return { summary: "Connect the captured AI model in Settings.", artifactIds: [] }
    }
  }
  const result = await opaque(io, frame, "execute", input, async () => {
    if (skill === "trending") {
      const deps = { settings, providerOverride: overrides.providerOverride, topWorksFn: overrides.topWorksFn ?? nodeTopWorksFn(), countFn: overrides.countFn ?? nodeCountFn(), topicGroupFn: overrides.topicGroupFn ?? nodeTopicGroupFn(), fieldGroupFn: overrides.fieldGroupFn ?? nodeTopicFieldGroupFn() }
      if (input.mode === "auto") return withLedger(ctx.storage, { orchestrator: "trending-refresh", trigger: "user" }, async () => {
        const result = await maybeAutoRefreshTrending(ctx.storage, deps)
        return { result, status: result === "refreshed" ? "ok" : result === "failed" ? "failed" : "skipped", reason: result }
      })
      const fields = z.array(z.object({ slug: z.string(), label: z.string().min(1) }).strict()).max(3).parse(input.fields)
      return withLedger(ctx.storage, { orchestrator: "trending-refresh", trigger: "user" }, async () => {
        const result = await runTrendingBoard(ctx.storage, { ...deps, fields, onProgress: field => progress({ type: "progress", field }) })
        return { result, status: result.surveyError ? "degraded" : "ok", reason: result.surveyError }
      })
    }
    if (skill === "find-papers") {
      const searchFn = overrides.searchFn ?? nodeResearchSearchFn({ reportErrors: true, storage: ctx.storage })
      if (input.transport === "search" || input.transport === "chat") {
        const chatInput = input.transport === "chat" ? parseAskChatInput(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "transport"))) : parseAskChatInput({ sessionId: input.sessionId ?? null, question: Search.parse(input).query, mode: "search", readSourcesOnly: false, sources: input.sources, operationId: input.operationId ?? root.operationId })
        const result = await askChat(ctx.storage, { input: chatInput, settings, providerOverride: overrides.providerOverride, searchFn, onProgress: stage => progress({ type: "progress", stage }), onText: text => progress({ type: "text", text }) })
        if (input.transport === "chat") return result
        if (result.message.error) throw new Error(result.message.error)
        const block = result.message.blocks?.find(item => item.type === "paper-results")
        if (block?.type !== "paper-results") throw new Error("Saved search result is unavailable")
        return { ...block.result, sessionId: result.sessionId }
      }
      return runResearchSearch(ctx.storage, Search.parse(input), { settings, providerOverride: overrides.providerOverride, searchFn, onStage: stage => progress({ type: "progress", stage }) })
    }
    const direction = Direction.parse(input)
    if (input.mode === "quick") return runQuickSpark(ctx.storage, { ...direction, settings, providerOverride: overrides.providerOverride })
    return runDeepSpark({ ...direction, storage: ctx.storage, persistence: "propose", settings, providerOverride: overrides.providerOverride,
      searchFn: overrides.searchFn ?? nodeSearchFn(), today: root.createdAt.slice(0, 10), onPhase: phase => progress({ type: "progress", phase }) })
  })
  await pending
  const proposed = skill === "idea-spark" && typeof result === "object" && result !== null && "proposedChangeset" in result ? result.proposedChangeset : undefined
  const changes = proposed && typeof proposed === "object" && "changes" in proposed ? proposed.changes : undefined
  const contents = changes ? z.array(z.object({ after: z.string().nullable() })).parse(changes).map(c => c.after ?? "").join("\n\n")
    : skill === "idea-spark" && input.mode === "quick" ? SeedSchema.parse(result).seeds.map(seed => `## ${seed.title}\n\n${seed.hook}\n\n${seed.rationale}\n\nSources: ${seed.groundingPageIds.join(", ") || "No specific vault pages"}`).join("\n\n")
    : skill === "find-papers" ? JSON.stringify(result, null, 2) : `# ${skill === "trending" ? "Trending" : "Idea Spark"}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
  const artifact = await opaque(io, frame, "artifact", result, () => io.publishArtifact({ kind: skill === "find-papers" ? "papers" : "markdown", title: NATIVE_TOOL_MANIFESTS.find(m => m.ref.skillId === skill)!.name,
    mediaType: skill === "find-papers" ? "application/json" : "text/markdown", bytes: new TextEncoder().encode(contents), sourceRefs: [...new Set([...root.contextRefs, ...(typeof result === "object" && result !== null && "sourceRefs" in result ? z.array(z.string()).parse(result.sourceRefs ?? []) : [])])] }))
  if (changes) await io.submitWikiProposal({ artifactIds: [artifact.id], changes: z.array(z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }).strict()).parse(changes) })
  const publicResult = changes && typeof result === "object" && result !== null && "outcome" in result ? { ...result, proposedChangeset: undefined, outcome: { ...z.object({ ideaPageId: z.string(), status: z.enum(["sparked", "in-progress", "scooped", "abandoned"]) }).parse(result.outcome), kind: "proposal", workflowId: root.id, artifactId: artifact.id } } : result
  await ctx.storage.write(nativePath(root.id, `result-${frame}`), JSON.stringify(publicResult))
  return { summary: `${NATIVE_TOOL_MANIFESTS.find(m => m.ref.skillId === skill)!.name} results are saved.`, artifactIds: [artifact.id] }
}
export async function executeNativeTool(ctx: WorkflowContext, run: ToolRun, io: WorkflowIO): Promise<void> {
  const manifest = NATIVE_TOOL_MANIFESTS.find(m => canonicalJson(m.ref) === canonicalJson(run.tool))
  if (!manifest) throw new Error("Captured native tool unavailable")
  // A durable keep choice completes saved outputs under the owning lease. No
  // native preflight, worker or model is needed; Task6 applies authorized saves.
  if (manifest.ref.skillId === "deep-review") {
    const raw = await ctx.storage.read(nativePath(run.id, `review-${run.id}`))
    if (raw && NativeReviewContinuationSchema.parse(JSON.parse(raw)).kept) return
  }
  const job = manifest.ref.skillId === "idea-spark" ? run.input.mode === "quick" ? "spark-quick" : "spark-deep" : manifest.ref.skillId === "trending" ? "trending" : undefined
  if (!job) { await executeInvocation(ctx, run, manifest.ref.skillId, run.input, run.id, io); return }
  await runSkillJob(ctx.storage, job, async progress => {
    await executeInvocation(ctx, run, manifest.ref.skillId, run.input, run.id, io, progress)
    const result = await ctx.storage.read(nativePath(run.id, `result-${run.id}`))
    if (!result) throw new Error("Complete the workflow setup or input before continuing.")
    return JSON.parse(result)
  }, undefined, { signature: run.id })
}
async function executeHelper(ctx: WorkflowContext, root: ToolRun, raw: HelperInvocation, io: WorkflowIO) {
  const invocation = HelperInvocationSchema.parse(raw)
  const manifest = NATIVE_TOOL_MANIFESTS.find(m => canonicalJson(m.ref) === canonicalJson(invocation.tool))
  if (!manifest || !root.dependencies.some(ref => canonicalJson(ref) === canonicalJson(invocation.tool))) throw new Error("Captured native helper unavailable")
  return HelperResultSchema.parse(await executeInvocation(ctx, root, manifest.ref.skillId, invocation.input, invocation.frameId, io))
}
export const nativeWorkflowAdapter = { execute: executeNativeTool, executeHelper }
export function registerNativeAdapters(): void {
  for (const manifest of NATIVE_TOOL_MANIFESTS) registerWorkflowAdapter(manifest.entrypoint, nativeWorkflowAdapter)
}
