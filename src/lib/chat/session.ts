import type { VaultStorage } from "../vault/storage"

export const CHATS_DIR = ".scispark/chats"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  /** Assistant only: bare bundle ids the answer leaned on. */
  citedPageIds?: string[]
  /** Assistant only: whether Read-Sources-Only was in effect for this answer. */
  readSourcesOnly?: boolean
  /** Assistant only: set when the answer ran on the deterministic fallback selector. */
  selectionFallback?: boolean
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

function sessionPath(id: string): string {
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
 * Corrupt files are skipped rather than failing the whole list.
 */
export async function listSessions(storage: VaultStorage): Promise<ChatSession[]> {
  const paths = await storage.list(`${CHATS_DIR}/`)
  const sessions: ChatSession[] = []
  for (const path of paths) {
    if (!path.endsWith(".json")) continue
    const id = path.slice(CHATS_DIR.length + 1, -".json".length)
    const session = await loadSession(storage, id)
    if (session != null) sessions.push(session)
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
