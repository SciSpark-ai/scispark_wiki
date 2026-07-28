import type { VaultStorage } from "../vault/storage"

export const CHATS_DIR = ".scispark/chats"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant only: FULL bundle ids the answer leaned on — `wiki/papers/x`,
   * not the bare slug `x`. That is the form `wikiHref`/`resolveWikiRouteId`
   * resolve against, and the orchestrator canonicalizes every model-written
   * citation to it (see `resolveIds` in `./orchestrator.ts`), so a renderer can
   * link one straight through without re-resolving. */
  citedPageIds?: string[]
  /** Assistant only: whether Read-Sources-Only was in effect for this answer. */
  readSourcesOnly?: boolean
  /** Assistant only: set when the answer ran on the deterministic fallback selector. */
  selectionFallback?: boolean
  /** Assistant only: ids of pages that were selected for this answer but could
   * not be read, so the answer was written without them (SP5 §5 — say what was
   * missing rather than answering short and silent). Omitted when none. */
  skippedPageIds?: string[]
  /** Assistant only: set when the answer failed; carries the real reason. */
  error?: string
}

export interface ChatSession {
  id: string
  title: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  messages: ChatMessage[]
}

const TITLE_MAX_LENGTH = 60

/**
 * Deterministic, LLM-free session title from the first user question: trim,
 * collapse internal whitespace, cut at a word boundary to at most 60
 * characters (appending "…" when cut), and fall back to "Untitled chat" for
 * empty/whitespace-only input.
 */
export function deriveTitle(firstQuestion: string): string {
  const collapsed = firstQuestion.trim().replace(/\s+/g, " ")
  if (collapsed.length === 0) return "Untitled chat"
  if (collapsed.length <= TITLE_MAX_LENGTH) return collapsed

  const truncated = collapsed.slice(0, TITLE_MAX_LENGTH)
  const lastSpace = truncated.lastIndexOf(" ")
  const cut = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
  return `${cut.trimEnd()}…`
}

/**
 * Mints a session id from an injected timestamp (no Date.now() inside this
 * module — the caller decides "now"). Deterministic for a given `now`.
 */
export function makeSessionId(now: Date): string {
  return `chat_${now.getTime()}`
}

/**
 * The ONLY id shape that may become a path. `makeSessionId` mints
 * `chat_<epochMs>` and `mintSessionId` may append `-2`, `-3`, … — both fit.
 */
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/

/** Is `id` safe to interpolate into a vault path? */
export function isValidSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id)
}

/**
 * The single place a session id becomes a path — and therefore the single
 * place the id is validated.
 *
 * A session id arrives RAW from the request body (`/api/skills/chat` parses
 * `AskChatInput` with a bare `req.json()`), so an unvalidated id would be a
 * path-traversal write primitive: `NodeFsVaultStorage` only rejects paths that
 * escape the vault ROOT, and `.scispark/chats/../settings.json` resolves to
 * `<root>/.scispark/settings.json` — inside the root, hence allowed. That is
 * the BYOK key file, which `/api/vault/file` deliberately 403s; routing around
 * that protection through a session id would overwrite the user's API keys,
 * companion name, trending anchors, theme and budget with session JSON, and
 * since it isn't a changeset there is nothing to revert.
 *
 * Guarding here (not at the route) covers every caller: the ask path, the
 * sidebar/`/history` listing and `/chat/[id]`'s read.
 */
function sessionPath(id: string): string {
  if (!isValidSessionId(id)) throw new Error(`invalid session id: ${id}`)
  return `${CHATS_DIR}/${id}.json`
}

/** Type guard: does a parsed JSON payload look like a ChatSession? A missing
 * `id` or `messages` (or a non-array `messages`) reads as corrupt. */
function isChatSessionShape(value: unknown): value is ChatSession {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === "string" && Array.isArray(v.messages)
}

/**
 * Loads one session by id. Returns null for a missing file, unparseable
 * JSON, or a payload lacking `id`/`messages` — corruption reads as absent,
 * never as a thrown error.
 */
export async function loadSession(storage: VaultStorage, id: string): Promise<ChatSession | null> {
  const raw = await storage.read(sessionPath(id))
  if (raw == null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isChatSessionShape(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

/** Writes a session, keyed by its own id. */
export async function saveSession(storage: VaultStorage, session: ChatSession): Promise<void> {
  await storage.write(sessionPath(session.id), JSON.stringify(session, null, 2))
}

/**
 * Lists every session under CHATS_DIR, newest first (by `updatedAt`).
 * Corrupt files are skipped rather than failing the whole list — and so is a
 * file whose name doesn't fit `SESSION_ID_RE`, which `sessionPath` would
 * (rightly) refuse to build a path for.
 */
export async function listSessions(storage: VaultStorage): Promise<ChatSession[]> {
  const paths = await storage.list(`${CHATS_DIR}/`)
  const sessions: ChatSession[] = []
  for (const path of paths) {
    if (!path.endsWith(".json")) continue
    const id = path.slice(CHATS_DIR.length + 1, -".json".length)
    if (!isValidSessionId(id)) continue
    const session = await loadSession(storage, id)
    if (session != null) sessions.push(session)
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
