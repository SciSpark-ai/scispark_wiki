import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { Bundle } from "../vault/bundle"
import type { WikiPage } from "../vault/types"
import { loadBundle, resolveLink } from "../vault/bundle"
import { buildIndexMarkdown } from "../vault/index-builder"
import { parseDocument } from "../vault/frontmatter"
import { runSkill } from "../skills/runner"
import { loadCompanionSettings } from "../companion/settings"
import {
  deriveTitle,
  isValidSessionId,
  loadSession,
  makeSessionId,
  saveSession,
  type ChatMessage,
  type ChatSession,
} from "./session"
import { selectPagesSkill, MAX_SELECTED_PAGES } from "./select-pages"
import { fallbackSelectPages } from "./fallback-select"
import { chatAnswerSkill } from "./answer"
import {
  getProject,
  ProjectNotFoundError,
  ProjectValidationError,
} from "../projects/repository"
import type { ProjectDetail } from "../projects/types"
import type { SourceId } from "../papers/types"
import { runResearchSearch } from "../skills/research-search"
import type { SearchFn } from "../skills/feed"
import type { ResearchSearchStage } from "../skills/research-search-contract"
import { loadSettings } from "../llm/settings"
import { neutralizeFenceMarkers } from "../skills/ingest-analysis"
import { SearchResultSchema } from "./blocks"
import { buildUserContext } from "../usermodel/context"
import { withVaultExclusive } from "../vault/exclusive"
import { loadReview } from "../review/store"
import { contextOverlap } from "../review/context"

/** How many prior turns travel verbatim with each question (SP5 §1). Earlier
 * turns are dropped, never summarized. */
export const MAX_HISTORY_TURNS = 6
export const MAX_CONTEXT_CHARS_PER_PAGE = 16_000
export const MAX_CONTEXT_CHARS_TOTAL = 64_000

export class ChatScopeError extends Error {}

export interface AskChatInput {
  /** null → start a new session. */
  sessionId: string | null
  question: string
  readSourcesOnly: boolean
  /** Stable project slug for a new scoped session. Existing sessions own their scope. */
  projectId?: string
  mode?: "chat" | "search"
  sources?: SourceId[]
  operationId?: string
}

export interface AskChatResult {
  sessionId: string
  /** The assistant turn, exactly as persisted. */
  message: ChatMessage
}

export interface AskChatOpts {
  input: AskChatInput
  settings?: LLMSettings
  providerOverride?: Partial<Record<Tier, LLMProvider>>
  now?: () => Date
  onProgress?: (stage: "selecting" | "answering" | ResearchSearchStage) => void
  onText?: (text: string) => void
  onSession?: (sessionId: string) => void
  searchFn?: SearchFn
}

/** Strict runtime parser for the public chat request. The API route receives
 * untyped JSON, so compile-time `AskChatInput` cannot protect session paths or
 * scope fields from malformed/extra values. */
export function parseAskChatInput(value: unknown): AskChatInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("chat input must be an object")
  }
  const record = value as Record<string, unknown>
  const allowed = new Set(["sessionId", "question", "readSourcesOnly", "projectId", "mode", "sources", "operationId"])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("chat input contains unsupported fields")
  }
  if (
    record.sessionId !== null &&
    (typeof record.sessionId !== "string" || !isValidSessionId(record.sessionId))
  ) {
    throw new Error("sessionId must be null or a safe session id")
  }
  if (typeof record.question !== "string" || record.question.trim().length === 0) {
    throw new Error("question must not be empty")
  }
  if (record.question.length > 20_000) throw new Error("question is too long")
  if (record.mode !== undefined && record.mode !== "chat" && record.mode !== "search") throw new Error("Unsupported chat mode")
  if (record.mode === "search" && record.question.length > 512) throw new Error("Keep the research question under 512 characters")
  if (record.mode === "search" && record.readSourcesOnly === true) throw new Error("Online search is unavailable in read-sources-only mode")
  if (record.sources !== undefined && (!Array.isArray(record.sources) || record.sources.length > 4 || record.sources.length === 0 || record.sources.some((s) => !["arxiv", "openalex", "s2", "pubmed"].includes(s)))) throw new Error("Invalid paper sources")
  if (record.operationId !== undefined && (typeof record.operationId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(record.operationId))) throw new Error("Invalid operation id")
  if (typeof record.readSourcesOnly !== "boolean") {
    throw new Error("readSourcesOnly must be a boolean")
  }
  if (
    record.projectId !== undefined &&
    (typeof record.projectId !== "string" || record.projectId.length === 0)
  ) {
    throw new Error("projectId must be a non-empty string")
  }
  return {
    sessionId: record.sessionId,
    question: record.question,
    readSourcesOnly: record.readSourcesOnly,
    ...(typeof record.projectId === "string" ? { projectId: record.projectId } : {}),
    ...(record.mode ? { mode: record.mode } : {}),
    ...(record.sources ? { sources: record.sources as SourceId[] } : {}),
    ...(record.operationId ? { operationId: record.operationId as string } : {}),
  }
}

/**
 * KB chat's orchestrator (SP5 Task 6) — the blessed pattern: this module owns
 * storage, retrieval, validation and degradation so `selectPagesSkill` and
 * `chatAnswerSkill` stay pure LLM units.
 *
 * Per question: load or create the session → append the user turn and PERSIST
 * IT IMMEDIATELY (a failed answer must never lose the question) → load the
 * bundle and narrow it to the scoped project's current direct members (when
 * present), then to `type: paper` pages when Read-Sources-Only is on →
 * `buildIndexMarkdown` over that narrowed set → `fast` selection call →
 * validate the returned ids against the real candidates → read each surviving
 * page and assemble its context block → `strong` answer call → drop any
 * `citedPageIds` that wasn't in the context we actually supplied → append the
 * assistant turn and persist.
 *
 * BOTH validation steps live here on purpose: the skills are pure LLM units by
 * design, so an id the model invented is only ever caught here. They are the
 * anti-hallucination filters — a fabricated selection id would otherwise read a
 * file that doesn't exist, and a fabricated citation would render as a
 * clickable chip to a page that was never consulted.
 *
 * Every degradation is independent: a failed selection call falls back to the
 * deterministic term-overlap selector (and says so via `selectionFallback`); a
 * page that fails to read is skipped (and named in `skippedPageIds`) rather
 * than failing the turn; a failed answer call persists an assistant message
 * carrying the real reason in `error`, leaving the user's question intact for
 * resend; and an empty knowledge base is answered deterministically, without
 * calling the LLM at all.
 */
export async function askChat(storage: VaultStorage, opts: AskChatOpts): Promise<AskChatResult> {
  const input = parseAskChatInput(opts.input)
  const validatedOpts: AskChatOpts = { ...opts, input }
  // A client normally disables its own composer while a turn is running, but
  // the same vault/session can still be open in two tabs. Serialize the whole
  // read-modify-answer-write cycle for a supplied session id so one turn can
  // never overwrite the other. New sessions already receive unique ids from
  // `mintSessionId`, so they do not share a transcript and need no queue.
  if (input.sessionId !== null) {
    return withVaultExclusive(storage, `chat-${input.sessionId}`, () => withSessionTurnQueue(storage, input.sessionId!, () => askChatTurn(storage, validatedOpts)))
  }
  return askChatTurn(storage, validatedOpts)
}

async function answerFromReview(storage: VaultStorage, opts: AskChatOpts,
  history: Array<{ role: "user" | "assistant"; content: string }>, project?: ProjectDetail, session?: ChatSession): Promise<ChatMessage | null> {
  const { input } = opts

  const latestMaterial = session?.messages.toReversed().flatMap((m) => m.blocks ?? []).find((b) => b.type === "review" || b.type === "review-citations" || b.type === "paper-results")
  if (latestMaterial?.type === "review" || latestMaterial?.type === "review-citations") {
    try {
      const review = await loadReview(storage, latestMaterial.runId)
      if (review.sessionId !== session?.id || review.brief.projectId !== project?.id) throw new Error("This review belongs to a different conversation scope")
      const version = latestMaterial.type === "review-citations" ? review.versions.find((v) => v.id === latestMaterial.versionId) : review.versions.at(-1)
      if (!version) return { role: "assistant", content: "This review is still in progress. You can inspect its saved sources or wait for the checked draft.", blocks: [{ type: "review", runId: review.id }] }
      // Only this saved version, never a sweep over other review histories.
      const evidence = [...(version.evidence ?? review.evidence)].sort((a, b) => contextOverlap(input.question, `${b.title} ${b.text}`) - contextOverlap(input.question, `${a.title} ${a.text}`)).slice(0, 8)
      let context = "Review source excerpts (not personal memory). Answer from these passages only. Access labels and truncation matter.\n"
      const included: string[] = []
      for (const e of evidence) {
        const block = `[${e.id}] ${e.title}\nAccess: ${e.access}\n${e.text.slice(0, 6000)}${e.text.length > 6000 ? "\n[Excerpt shortened; later text not supplied to this answer.]" : ""}\n\n`
        if (context.length + block.length > MAX_CONTEXT_CHARS_TOTAL) break
        included.push(e.id); context += block
      }
      if (!included.length) throw new Error("No source text remains in this report version")
      opts.onProgress?.("answering")
      const answer = await runSkill({ skill: chatAnswerSkill, storage, settings: opts.settings, providerOverride: opts.providerOverride, now: opts.now, onText: opts.onText,
        input: { question: input.question, context, history, readSourcesOnly: true, projectInstructions: project?.instructions } })
      if (answer.status !== "ok" || !answer.output) throw new Error(answer.error ?? "Review answer unavailable")
      if (answer.output.citedPageIds.some((p) => !included.includes(p)) || [...answer.output.answer.matchAll(/\[(P\d+)\]/g)].some((m) => !included.includes(m[1]))) throw new Error("The answer introduced a reference outside this report's source excerpts")
      return { role: "assistant", content: answer.output.answer, blocks: [{ type: "review-citations", runId: review.id, versionId: version.id, sourceIds: answer.output.citedPageIds }] }
    } catch (e) { return { role: "assistant", content: "I couldn't answer from this saved review. Your question is retained in History.", error: e instanceof Error ? e.message : "Review unavailable" } }
  }

  return null
}

async function askChatTurn(storage: VaultStorage, opts: AskChatOpts): Promise<AskChatResult> {
  const now = opts.now ?? (() => new Date())
  const { input } = opts
  const { session, project } = await loadOrCreateSession(storage, input, now)
  const requestSignature = JSON.stringify({ mode: input.mode ?? "chat", readSourcesOnly: input.readSourcesOnly, sources: input.sources ? [...new Set(input.sources)].sort() : null })
  if (input.operationId && session.messages.some((m) => m.operationId === input.operationId)) {
    const question = session.messages.find((m) => m.operationId === input.operationId && m.role === "user")
    if (question?.content !== input.question) throw new Error("This operation already belongs to a different question")
    if (question.requestSignature && question.requestSignature !== requestSignature) throw new Error("This operation already belongs to different search options")
    const previous = session.messages.find((m) => m.operationId === input.operationId && m.role === "assistant")
    if (!previous) throw new Error("This turn was interrupted. Your question is in History; send a new message to retry.")
    return { sessionId: session.id, message: previous }
  }

  // The history the skills see: prior turns only (the current question travels
  // in its own field), oldest→newest, trimmed to the last MAX_HISTORY_TURNS.
  //
  // Turns carrying `error` are dropped FIRST, before the slice: their content
  // is our own degradation boilerplate ("I couldn't answer that just now…"),
  // never anything the model said. Feeding it back is worse than useless —
  // MAX_HISTORY_TURNS counts MESSAGES (three exchanges), so two failed turns
  // would leave the model looking mostly at apology text and can pull it
  // toward refusing a question it could otherwise answer. Dropping before the
  // slice also means a failed turn doesn't evict a real one from the window.
  const history = session.messages
    .filter((m) => m.error === undefined)
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }))

  session.messages.push({ role: "user", content: input.question, ...(input.operationId ? { operationId: input.operationId, requestSignature } : {}) })
  session.updatedAt = now().toISOString()
  // Persisted BEFORE any LLM call: everything below can fail, and when it does
  // the user must still find their question in the transcript.
  await saveSession(storage, session)
  opts.onSession?.(session.id)

  const message = input.mode === "search"
    ? await searchQuestion(storage, opts, session, project)
    : await answerQuestion(storage, opts, history, project, session)
  if (input.operationId) message.operationId = input.operationId

  session.messages.push(message)
  session.updatedAt = now().toISOString()
  await saveSession(storage, session)

  return { sessionId: session.id, message }
}

async function searchQuestion(storage: VaultStorage, opts: AskChatOpts, session: ChatSession, project?: ProjectDetail): Promise<ChatMessage> {
  try {
    if (!opts.searchFn) throw new Error("Paper search is not configured")
    const prior = session.messages.filter((m) => !m.error).slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 2000)}\n${m.blocks?.flatMap((b) => b.type === "paper-results" ? b.result.items.map((i) => i.paper.title) : []).join("\n") ?? ""}`).join("\n").slice(0, 16_000)
    // Scope-specific context contains no unrelated private library material.
    const personalContext = project
      ? `<<<PROJECT>>>\n${neutralizeFenceMarkers(`${project.title}\n${project.instructions}`)}\n<<<END-PROJECT>>>`
      : (await buildUserContext(storage, { eventLimit: 40 })).compactText
    const contextText = `${personalContext}\n<<<CONVERSATION>>>\n${neutralizeFenceMarkers(prior)}\n<<<END-CONVERSATION>>>`
    const result = SearchResultSchema.parse(await runResearchSearch(storage, { query: opts.input.question, sources: opts.input.sources }, {
      settings: opts.settings ?? await loadSettings(storage), searchFn: opts.searchFn,
      providerOverride: opts.providerOverride, now: opts.now, onStage: opts.onProgress, contextText,
    }))
    return {
      role: "assistant", content: `Found ${result.items.length} papers for ${result.plan.interpretation}.`,
      blocks: [{ type: "paper-results", retrievedAt: (opts.now?.() ?? new Date()).toISOString(), result }],
    }
  } catch (error) {
    return { role: "assistant", content: "The search did not finish. Your question is saved in History; you can try again.", error: error instanceof Error ? error.message : String(error) }
  }
}

// One queue per storage/session pair. This protects the local single-process
// runtime; cross-process coordination remains a sync-backend concern, matching
// the write queues used by highlights, metering, events, and settings.
const sessionTurnQueues = new WeakMap<VaultStorage, Map<string, Promise<void>>>()

function withSessionTurnQueue<T>(storage: VaultStorage, sessionId: string, work: () => Promise<T>): Promise<T> {
  let queues = sessionTurnQueues.get(storage)
  if (queues === undefined) {
    queues = new Map<string, Promise<void>>()
    sessionTurnQueues.set(storage, queues)
  }

  const previous = queues.get(sessionId) ?? Promise.resolve()
  const result = previous.then(work)
  // A failed turn must not wedge later turns. Remove idle entries so a client
  // supplying many distinct ids cannot grow the per-storage map forever.
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queues.set(sessionId, tail)
  void tail.then(() => {
    if (queues?.get(sessionId) === tail) queues.delete(sessionId)
  })
  return result
}

/**
 * Ids minted in this process but not yet on disk. `makeSessionId` is a pure
 * function of its `Date` with no random suffix (unlike `makeChangesetId`), so
 * two sessions started in the same millisecond would mint the SAME id and the
 * second `saveSession` would silently overwrite the first. `mintSessionId`
 * closes that on both axes: the on-disk check catches an id already written
 * (by an earlier run or another process), and this synchronous reservation
 * catches concurrent in-process callers whose disk checks interleave. Entries
 * are never removed — a released id could be re-minted by a caller that is
 * still between its own check and its first write.
 */
const reservedSessionIds = new WeakMap<VaultStorage, Set<string>>()

async function mintSessionId(storage: VaultStorage, now: () => Date): Promise<string> {
  const base = makeSessionId(now())
  let reserved = reservedSessionIds.get(storage)
  if (!reserved) {
    reserved = new Set<string>()
    reservedSessionIds.set(storage, reserved)
  }

  let candidate = base
  let suffix = 2
  for (;;) {
    if (!reserved.has(candidate)) {
      // Claimed synchronously, BEFORE the await below: a concurrent caller
      // reaching this line while our disk check is in flight sees the id taken
      // and moves on to the next suffix.
      reserved.add(candidate)
      if ((await loadSession(storage, candidate)) === null) return candidate
    }
    candidate = `${base}-${suffix++}`
  }
}

async function loadOrCreateSession(
  storage: VaultStorage,
  input: AskChatInput,
  now: () => Date,
): Promise<{ session: ChatSession; project?: ProjectDetail }> {
  if (input.sessionId != null) {
    const existing = await loadSession(storage, input.sessionId)
    // A missing/corrupt file reads as absent (Task 2's contract), so rather
    // than failing the turn we start a session AT THAT id — the caller is
    // holding a link to it, and the alternative is losing the question.
    if (existing != null) {
      if (input.projectId !== undefined && input.projectId !== existing.projectId) {
        throw new ChatScopeError("this conversation's project scope cannot be changed")
      }
      if (existing.projectId === undefined) return { session: existing }
      return { session: existing, project: await requireProject(storage, existing.projectId) }
    }

    const project = input.projectId === undefined
      ? undefined
      : await requireProject(storage, input.projectId)
    const timestamp = now().toISOString()
    return {
      session: {
        id: input.sessionId,
        title: deriveTitle(input.question),
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [],
        ...(project ? { projectId: project.id, projectTitle: project.title } : {}),
      },
      project,
    }
  }

  const project = input.projectId === undefined
    ? undefined
    : await requireProject(storage, input.projectId)
  const timestamp = now().toISOString()
  return {
    session: {
      id: await mintSessionId(storage, now),
      title: deriveTitle(input.question),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
      ...(project ? { projectId: project.id, projectTitle: project.title } : {}),
    },
    project,
  }
}

async function requireProject(storage: VaultStorage, projectId: string): Promise<ProjectDetail> {
  try {
    return await getProject(storage, projectId)
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof ProjectValidationError) {
      throw new ChatScopeError(
        `Project “${projectId}” is unavailable. This scoped conversation remains readable but cannot continue.`,
      )
    }
    throw error
  }
}

/** The grounded pipeline for one turn; always resolves with the assistant message to persist. */
async function answerQuestion(
  storage: VaultStorage,
  opts: AskChatOpts,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  project?: ProjectDetail,
  session?: ChatSession,
): Promise<ChatMessage> {
  const { input } = opts

  const reviewAnswer = await answerFromReview(storage, opts, history, project, session)
  if (reviewAnswer) return reviewAnswer

  // A follow-up can read saved online results without fetching them again.
  // Read-sources-only retains its existing, narrower knowledge-base semantics.
  const searchBlock = input.readSourcesOnly ? undefined : session?.messages.toReversed().flatMap((m) => m.blocks ?? []).find((b) => b.type === "paper-results")
  if (searchBlock?.type === "paper-results") {
    const items = searchBlock.result.items
    const selected: typeof items = []
    let context = ""
    for (const item of items) {
      const block = `[search-paper-${selected.length + 1}] ${item.paper.title}\nAbstract (not full text): ${(item.paper.abstract ?? "Not available").slice(0, 6000)}\n\n`
      if (context.length + block.length > MAX_CONTEXT_CHARS_TOTAL) break
      selected.push(item); context += block
    }
    opts.onProgress?.("answering")
    const run = await runSkill({ skill: chatAnswerSkill, storage, settings: opts.settings, providerOverride: opts.providerOverride, now: opts.now, onText: opts.onText,
      input: { question: input.question, context, history, readSourcesOnly: true, projectInstructions: project?.instructions } })
    if (run.status !== "ok" || !run.output) return { role: "assistant", content: "I couldn't answer from the saved paper results. Your question is saved.", error: run.error ?? "Answer unavailable" }
    const cited = new Set(run.output.citedPageIds)
    const papers = selected.filter((_, i) => cited.has(`search-paper-${i + 1}`)).map((item) => item.paper)
    return { role: "assistant", content: run.output.answer, blocks: [{ type: "paper-citations", papers }] }
  }

  // A vault-wide read failure is degraded like any other layer rather than
  // rejecting: the user's question is already persisted, so the transcript must
  // gain a turn saying WHY no answer came back — an unresolved rejection here
  // would leave a question sitting alone in the session forever.
  let bundle: Bundle
  try {
    bundle = await loadBundle(storage)
  } catch (err) {
    return {
      role: "assistant",
      content: "I couldn't read your knowledge base just now. Your question is saved; try again.",
      citedPageIds: [],
      readSourcesOnly: input.readSourcesOnly,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const candidates = candidatePages(bundle, input.readSourcesOnly, project?.id)

  if (candidates.length === 0) {
    return noCandidatesMessage(bundle, input.readSourcesOnly, project)
  }

  const candidateBundle: Bundle = {
    pages: new Map(candidates.map((page) => [page.id, page])),
    links: [],
    errors: [],
  }

  opts.onProgress?.("selecting")
  const { pageIds, selectionFallback } = await selectPages(storage, opts, candidateBundle, history)

  const { context, includedBundle, skippedPageIds, truncatedPageIds } = await assembleContext(
    storage,
    candidateBundle,
    pageIds,
  )

  opts.onProgress?.("answering")
  const companionName = await resolveCompanionName(storage)
  const run = await runSkill({
    skill: chatAnswerSkill,
    onText: opts.onText,
    input: {
      question: input.question,
      context,
      history,
      readSourcesOnly: input.readSourcesOnly,
      ...(project?.instructions.trim()
        ? { projectInstructions: project.instructions }
        : {}),
      ...(companionName !== undefined ? { companionName } : {}),
    },
    storage,
    settings: opts.settings,
    providerOverride: opts.providerOverride,
    now: opts.now,
  })

  const base: ChatMessage = {
    role: "assistant",
    content: "",
    citedPageIds: [],
    readSourcesOnly: input.readSourcesOnly,
    ...(selectionFallback ? { selectionFallback: true } : {}),
    ...(skippedPageIds.length > 0 ? { skippedPageIds } : {}),
    ...(truncatedPageIds.length > 0 ? { truncatedPageIds } : {}),
  }

  if (run.status !== "ok" || run.output === undefined) {
    const reason = run.error ?? `chat-answer run finished with status "${run.status}"`
    return {
      ...base,
      content: "I couldn't answer that just now — the answer step failed. Your question is saved; try again.",
      error: reason,
    }
  }

  return {
    ...base,
    content: run.output.answer,
    // The second anti-hallucination filter: resolved against the pages whose
    // content we ACTUALLY supplied (so a skipped page can't be cited either),
    // canonicalized to full bundle ids — what `wikiHref` resolves against.
    citedPageIds: resolveIds(run.output.citedPageIds, includedBundle),
  }
}

/** Read-Sources-Only narrows the candidate pool to `paper` pages — the switch
 * changes the candidate set, not the pipeline (SP5 §1). */
function candidatePages(
  bundle: Bundle,
  readSourcesOnly: boolean,
  projectId?: string,
): WikiPage[] {
  let pages = [...bundle.pages.values()]
  if (projectId !== undefined) {
    pages = pages.filter((page) =>
      Array.isArray(page.frontmatter.projects) &&
      page.frontmatter.projects.every((value) => typeof value === "string") &&
      page.frontmatter.projects.includes(projectId),
    )
  }
  if (readSourcesOnly) pages = pages.filter((page) => page.frontmatter.type === "paper")
  return pages.sort((a, b) => a.id.localeCompare(b.id))
}

/** The `fast` selection call, degrading to the deterministic term-overlap selector. */
async function selectPages(
  storage: VaultStorage,
  opts: AskChatOpts,
  candidateBundle: Bundle,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ pageIds: string[]; selectionFallback: boolean }> {
  const run = await runSkill({
    skill: selectPagesSkill,
    input: {
      indexMarkdown: buildIndexMarkdown(candidateBundle),
      question: opts.input.question,
      history,
    },
    storage,
    settings: opts.settings,
    providerOverride: opts.providerOverride,
    now: opts.now,
  })

  if (run.status === "ok" && run.output !== undefined) {
    return { pageIds: resolveIds(run.output.pageIds, candidateBundle), selectionFallback: false }
  }

  console.warn("[chat] page selection failed; falling back to term overlap:", run.error)
  return {
    pageIds: fallbackSelectPages(candidateBundle, opts.input.question, MAX_SELECTED_PAGES),
    selectionFallback: true,
  }
}

/**
 * BOTH anti-hallucination filters run through here: every id a model wrote —
 * whether selecting pages to read or citing pages it used — is resolved against
 * a REAL set of pages and DROPPED when it matches nothing.
 *
 * Two id shapes are accepted because both are plausibly "verbatim from the
 * INDEX": `buildIndexMarkdown` renders each page as `- [[<slug>]] — <title>`,
 * i.e. only the final path segment, while the skill's illustrative example
 * shows a path-ish id — so a model may echo either. Slug resolution is
 * `resolveLink`'s (the vault's one implementation: handles path-qualified
 * slugs like `concepts/x` too, and breaks a shared-slug tie by sorted id).
 * Results are deduped, kept in the model's order, and capped at `limit`.
 */
function resolveIds(ids: string[], bundle: Bundle, limit: number = MAX_SELECTED_PAGES): string[] {
  const resolved: string[] = []
  for (const raw of ids) {
    const id = canonicalId(raw, bundle)
    if (id == null || resolved.includes(id)) continue
    resolved.push(id)
    if (resolved.length === limit) break
  }
  return resolved
}

/** A model-written id → the real bundle id it names, or null when it names nothing. */
function canonicalId(raw: string, bundle: Bundle): string | null {
  const trimmed = raw.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "")
  if (trimmed.length === 0) return null
  if (bundle.pages.has(trimmed)) return trimmed
  return resolveLink(bundle, trimmed)?.id ?? null
}

interface AssembledContext {
  context: string
  /** Exactly the pages represented in `context` — the citation whitelist. */
  includedBundle: Bundle
  /** Selected pages dropped because reading them failed. */
  skippedPageIds: string[]
  /** Selected pages shortened/omitted by deterministic context budgets. */
  truncatedPageIds: string[]
}

/**
 * Reads each selected page FRESH from storage (rather than reusing the bundle's
 * parsed copy) so the answer is grounded in the file's current content, and so
 * a transient per-file read failure degrades to "skip this page" instead of
 * failing the whole turn.
 */
async function assembleContext(
  storage: VaultStorage,
  candidateBundle: Bundle,
  pageIds: string[],
): Promise<AssembledContext> {
  const blocks: string[] = []
  const included = new Map<string, WikiPage>()
  const skippedPageIds: string[] = []
  const truncatedPageIds: string[] = []
  let usedChars = 0

  for (const id of pageIds) {
    const page = candidateBundle.pages.get(id)
    if (page === undefined) continue
    try {
      const raw = await storage.read(page.path)
      if (raw == null) {
        skippedPageIds.push(id)
        continue
      }
      const { frontmatter, body } = parseDocument(raw)
      const fresh: WikiPage = { ...page, frontmatter, body }
      const separator = blocks.length === 0 ? "" : "\n\n---\n\n"
      const rendered = renderContextBlock(fresh)
      const perPage = rendered.slice(0, MAX_CONTEXT_CHARS_PER_PAGE)
      const remaining = Math.max(0, MAX_CONTEXT_CHARS_TOTAL - usedChars - separator.length)
      const block = perPage.slice(0, remaining)
      if (rendered.length > block.length && !truncatedPageIds.includes(id)) {
        truncatedPageIds.push(id)
      }
      if (block.length === 0) continue
      blocks.push(block)
      usedChars += separator.length + block.length
      included.set(id, fresh)
    } catch (err) {
      console.warn(`[chat] context read failed for "${id}"; skipping it:`, err)
      skippedPageIds.push(id)
    }
  }

  const context =
    blocks.length > 0 ? blocks.join("\n\n---\n\n") : "(no pages in the knowledge base matched this question)"
  return {
    context,
    includedBundle: { pages: included, links: [], errors: [] },
    skippedPageIds,
    truncatedPageIds,
  }
}

/**
 * One page's context block. Wiki pages contribute their body; PAPER pages
 * contribute their TL;DR and abstract only (SP5 §1) — never the agent-written
 * digest section, which is synthesis rather than source material.
 */
function renderContextBlock(page: WikiPage): string {
  const header = [`### ${page.id}`, `Title: ${page.frontmatter.title}`, `Type: ${page.frontmatter.type}`]
  return `${header.join("\n")}\n\n${page.frontmatter.type === "paper" ? paperContent(page) : page.body.trim()}`
}

function paperContent(page: WikiPage): string {
  const parts: string[] = []
  const tldr = page.frontmatter.tldr
  if (typeof tldr === "string" && tldr.trim() !== "") parts.push(`TL;DR: ${tldr.trim()}`)
  const abstract = extractSection(page.body, "Abstract")
  if (abstract !== null) parts.push(`Abstract:\n${abstract}`)
  return parts.length > 0 ? parts.join("\n\n") : "(no abstract or TL;DR stored for this paper)"
}

/** The body of a `## <name>` section, up to the next heading of any level; null when absent. */
function extractSection(body: string, name: string): string | null {
  const lines = body.split("\n")
  const start = lines.findIndex((line) => /^#{1,6}\s+/.test(line) && line.replace(/^#{1,6}\s+/, "").trim() === name)
  if (start === -1) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,6}\s+/.test(line))
  const section = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim()
  return section === "" ? null : section
}

/**
 * Deterministic, LLM-free answer when there is nothing to answer FROM.
 *
 * "Empty" and "unreadable" are told apart on purpose: a vault whose files ALL
 * failed to parse also yields zero pages, and calling that "your knowledge base
 * is empty" is exactly the pretend-success SP5 §5 forbids — the pages are on
 * disk, they just didn't load, and the user can fix that. The real parse errors
 * ride along in `error`.
 */
function noCandidatesMessage(
  bundle: Bundle,
  readSourcesOnly: boolean,
  project?: ProjectDetail,
): ChatMessage {
  if (bundle.pages.size === 0 && bundle.errors.length > 0) {
    return {
      role: "assistant",
      content:
        "I couldn't read any pages from your knowledge base — every file in it failed to load, so there is nothing for me to answer from. Your pages are still on disk; the reason is below.",
      citedPageIds: [],
      readSourcesOnly,
      error: bundle.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
    }
  }

  const content = project
    ? readSourcesOnly
      ? `“${project.title}” has no paper members yet, so there are no project sources to read from.`
      : `“${project.title}” has no members yet, so there is no project context to answer from.`
    : readSourcesOnly
    ? "You have no saved papers yet, so there are no sources for me to read from. Search for papers on /papers and save one — then ask me again."
    : "Your knowledge base is empty, so there is nothing for me to answer from yet. Search for papers on /papers and save one — then ask me again."
  return { role: "assistant", content, citedPageIds: [], readSourcesOnly }
}

/** The user's companion name for the answer's tone wrap; undefined (persona default) on any failure. */
async function resolveCompanionName(storage: VaultStorage): Promise<string | undefined> {
  try {
    return (await loadCompanionSettings(storage)).companionName
  } catch {
    return undefined
  }
}
