import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, Tier } from "../llm/types"
import type { LLMSettings } from "../llm/settings"
import type { Bundle } from "../vault/bundle"
import type { WikiPage } from "../vault/types"
import { loadBundle } from "../vault/bundle"
import { buildIndexMarkdown } from "../vault/index-builder"
import { parseDocument } from "../vault/frontmatter"
import { runSkill } from "../skills/runner"
import { loadCompanionSettings } from "../companion/settings"
import { deriveTitle, loadSession, makeSessionId, saveSession, type ChatMessage, type ChatSession } from "./session"
import { selectPagesSkill, MAX_SELECTED_PAGES } from "./select-pages"
import { fallbackSelectPages } from "./fallback-select"
import { chatAnswerSkill } from "./answer"

/** How many prior turns travel verbatim with each question (SP5 §1). Earlier
 * turns are dropped, never summarized. */
export const MAX_HISTORY_TURNS = 6

export interface AskChatInput {
  /** null → start a new session. */
  sessionId: string | null
  question: string
  readSourcesOnly: boolean
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
  onProgress?: (stage: "selecting" | "answering") => void
}

/**
 * KB chat's orchestrator (SP5 Task 6) — the blessed pattern: this module owns
 * storage, retrieval, validation and degradation so `selectPagesSkill` and
 * `chatAnswerSkill` stay pure LLM units.
 *
 * Per question: load or create the session → append the user turn and PERSIST
 * IT IMMEDIATELY (a failed answer must never lose the question) → load the
 * bundle and narrow it to `type: paper` pages when Read-Sources-Only is on →
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
  const now = opts.now ?? (() => new Date())
  const { input } = opts

  const session = await loadOrCreateSession(storage, input, now)

  // The history the skills see: prior turns only (the current question travels
  // in its own field), oldest→newest, trimmed to the last MAX_HISTORY_TURNS.
  const history = session.messages
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content }))

  session.messages.push({ role: "user", content: input.question })
  session.updatedAt = now().toISOString()
  // Persisted BEFORE any LLM call: everything below can fail, and when it does
  // the user must still find their question in the transcript.
  await saveSession(storage, session)

  const message = await answerQuestion(storage, opts, history)

  session.messages.push(message)
  session.updatedAt = now().toISOString()
  await saveSession(storage, session)

  return { sessionId: session.id, message }
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
): Promise<ChatSession> {
  if (input.sessionId != null) {
    const existing = await loadSession(storage, input.sessionId)
    // A missing/corrupt file reads as absent (Task 2's contract), so rather
    // than failing the turn we start a session AT THAT id — the caller is
    // holding a link to it, and the alternative is losing the question.
    if (existing != null) return existing
    const timestamp = now().toISOString()
    return {
      id: input.sessionId,
      title: deriveTitle(input.question),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    }
  }

  const timestamp = now().toISOString()
  return {
    id: await mintSessionId(storage, now),
    title: deriveTitle(input.question),
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  }
}

/** The grounded pipeline for one turn; always resolves with the assistant message to persist. */
async function answerQuestion(
  storage: VaultStorage,
  opts: AskChatOpts,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<ChatMessage> {
  const { input } = opts

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

  const candidates = candidatePages(bundle, input.readSourcesOnly)

  if (candidates.length === 0) return emptyKnowledgeBaseMessage(input.readSourcesOnly)

  const candidateBundle: Bundle = {
    pages: new Map(candidates.map((page) => [page.id, page])),
    links: [],
    errors: [],
  }

  opts.onProgress?.("selecting")
  const { pageIds, selectionFallback } = await selectPages(storage, opts, candidateBundle, history)

  const { context, includedIds, skippedPageIds } = await assembleContext(storage, candidateBundle, pageIds)

  opts.onProgress?.("answering")
  const companionName = await resolveCompanionName(storage)
  const run = await runSkill({
    skill: chatAnswerSkill,
    input: {
      question: input.question,
      context,
      history,
      readSourcesOnly: input.readSourcesOnly,
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
    // The second anti-hallucination filter: only ids that were genuinely in
    // the context we supplied survive, canonicalized to bundle ids.
    citedPageIds: validateCitations(run.output.citedPageIds, includedIds),
  }
}

/** Read-Sources-Only narrows the candidate pool to `paper` pages — the switch
 * changes the candidate set, not the pipeline (SP5 §1). */
function candidatePages(bundle: Bundle, readSourcesOnly: boolean): WikiPage[] {
  const pages = [...bundle.pages.values()]
  return readSourcesOnly ? pages.filter((page) => page.frontmatter.type === "paper") : pages
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
    return { pageIds: resolveSelectedIds(run.output.pageIds, candidateBundle), selectionFallback: false }
  }

  console.warn("[chat] page selection failed; falling back to term overlap:", run.error)
  return {
    pageIds: fallbackSelectPages(candidateBundle, opts.input.question, MAX_SELECTED_PAGES),
    selectionFallback: true,
  }
}

/**
 * The first anti-hallucination filter: every id the model returned is resolved
 * against the REAL candidate set and dropped when it matches nothing.
 *
 * Both id shapes are accepted because both are plausibly "verbatim from the
 * INDEX": `buildIndexMarkdown` renders each page as `- [[<slug>]] — <title>`,
 * i.e. only the final path segment, while the skill's illustrative example
 * shows a path-ish id — so a model may echo either. A bare slug shared by two
 * pages resolves to the first by sorted id, deterministically. Results are
 * deduped, kept in the model's order, and capped at MAX_SELECTED_PAGES.
 */
function resolveSelectedIds(ids: string[], candidateBundle: Bundle): string[] {
  const bySlug = new Map<string, string>()
  for (const id of [...candidateBundle.pages.keys()].sort()) {
    const slug = id.split("/").pop() as string
    if (!bySlug.has(slug)) bySlug.set(slug, id)
  }

  const resolved: string[] = []
  for (const raw of ids) {
    const id = canonicalId(raw, candidateBundle, bySlug)
    if (id == null || resolved.includes(id)) continue
    resolved.push(id)
    if (resolved.length === MAX_SELECTED_PAGES) break
  }
  return resolved
}

/** A model-written id → the real bundle id it names, or null when it names nothing. */
function canonicalId(raw: string, candidateBundle: Bundle, bySlug: Map<string, string>): string | null {
  const trimmed = raw.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "")
  if (trimmed.length === 0) return null
  if (candidateBundle.pages.has(trimmed)) return trimmed
  const slug = trimmed.split("/").pop() as string
  return bySlug.get(slug) ?? null
}

interface AssembledContext {
  context: string
  /** The ids actually represented in `context` — the citation whitelist. */
  includedIds: string[]
  /** Selected pages dropped because reading them failed. */
  skippedPageIds: string[]
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
  const includedIds: string[] = []
  const skippedPageIds: string[] = []

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
      blocks.push(renderContextBlock({ ...page, frontmatter, body }))
      includedIds.push(id)
    } catch (err) {
      console.warn(`[chat] context read failed for "${id}"; skipping it:`, err)
      skippedPageIds.push(id)
    }
  }

  const context =
    blocks.length > 0 ? blocks.join("\n\n---\n\n") : "(no pages in the knowledge base matched this question)"
  return { context, includedIds, skippedPageIds }
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

/** Keeps only citations that name a page whose content we actually supplied.
 * Accepts the same two id shapes as `resolveSelectedIds` (full bundle id or
 * bare slug, first-by-sorted-id on a shared slug) and canonicalizes to the
 * bundle id, which is what `wikiHref` and the paper route resolve against. */
function validateCitations(citedPageIds: string[], includedIds: string[]): string[] {
  const included = new Set(includedIds)
  const bySlug = new Map<string, string>()
  for (const id of [...includedIds].sort()) {
    const slug = id.split("/").pop() as string
    if (!bySlug.has(slug)) bySlug.set(slug, id)
  }

  const kept: string[] = []
  for (const raw of citedPageIds) {
    const trimmed = raw.trim().replace(/^\[\[|\]\]$/g, "").replace(/\.md$/i, "")
    const id = included.has(trimmed) ? trimmed : (bySlug.get(trimmed.split("/").pop() ?? "") ?? null)
    if (id == null || kept.includes(id)) continue
    kept.push(id)
  }
  return kept
}

/** Deterministic, LLM-free answer for a knowledge base with nothing to answer from. */
function emptyKnowledgeBaseMessage(readSourcesOnly: boolean): ChatMessage {
  const content = readSourcesOnly
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
