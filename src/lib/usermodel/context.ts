import type { VaultStorage } from "../vault/storage"
import { readUserModel } from "./pages"
import { readRecentEvents } from "../events/log"
import type { LoggedEvent } from "../events/types"
import { loadBundle } from "../vault/bundle"
import { neutralizeFenceMarkers } from "../skills/ingest-analysis"

export interface UserContext {
  /** Assembled prompt block: fenced PROFILE / INTERESTS / STANDING-INSTRUCTIONS /
   * RECENT-ACTIVITY / LIBRARY sections, empty ones omitted, hard-capped at 24 000 chars. */
  text: string
  /** Small profile+interests+activity-counts block for the fast rank stage, repeated per batch. */
  compactText: string
  /** Number of events actually rendered in `text`'s RECENT-ACTIVITY section (post 24k-cap truncation). */
  eventCount: number
}

const DEFAULT_EVENT_LIMIT = 100
const LIBRARY_CAP = 50
const MAX_TEXT_CHARS = 24_000

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.trim() !== ""
}

/** Renders one `<<<NAME>>>\n{body}\n<<<END>>>` block, neutralizing fence markers in the body
 * so untrusted page/event content can never forge a fence boundary (same M4 defense as
 * `wikiDataFence` in `src/lib/skills/ingest-analysis.ts`). */
function fenceBlock(name: string, body: string): string {
  return `<<<${name}>>>\n${neutralizeFenceMarkers(body)}\n<<<END>>>`
}

/** Picks the most human-meaningful field on an event for the activity line: title > query >
 * paperKey/changesetId > nothing. Reads via a loose cast so future event-union members
 * (the union is deliberately open, per the M5 plan) degrade to "nothing" instead of erroring. */
function eventDetail(event: LoggedEvent): string {
  const e = event as unknown as Record<string, unknown>
  if (typeof e.title === "string" && e.title.trim() !== "") return e.title
  if (typeof e.query === "string" && e.query.trim() !== "") return e.query
  if (typeof e.paperKey === "string" && e.paperKey.trim() !== "") return e.paperKey
  if (typeof e.changesetId === "string" && e.changesetId.trim() !== "") return e.changesetId
  return ""
}

function eventLine(event: LoggedEvent): string {
  return `- [${event.ts}] ${event.type}: ${eventDetail(event)}`
}

interface LibraryEntry {
  title: string
  created: string
  year: unknown
}

function libraryLine(entry: LibraryEntry): string {
  const year = entry.year
  const hasYear = year !== undefined && year !== null && String(year).trim() !== ""
  return hasYear ? `- ${entry.title} (${year})` : `- ${entry.title}`
}

async function loadLibraryEntries(storage: VaultStorage): Promise<LibraryEntry[]> {
  const bundle = await loadBundle(storage)
  const papers: LibraryEntry[] = []
  for (const page of bundle.pages.values()) {
    if (page.frontmatter.type !== "paper") continue
    papers.push({
      title: page.frontmatter.title,
      created: page.frontmatter.created,
      year: page.frontmatter.year,
    })
  }
  // Newest by frontmatter.created first (ISO date strings sort lexicographically); cap to 50.
  papers.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
  return papers.slice(0, LIBRARY_CAP)
}

function activityCounts(events: LoggedEvent[]): { saves: number; dismissals: number; ingests: number } {
  let saves = 0
  let dismissals = 0
  let ingests = 0
  for (const e of events) {
    if (e.type === "feed_save") saves++
    else if (e.type === "feed_dismiss") dismissals++
    else if (e.type === "ingest") ingests++
  }
  return { saves, dismissals, ingests }
}

function buildCompactText(profile: string | null, interests: string | null, events: LoggedEvent[]): string {
  const parts: string[] = []
  if (isNonEmpty(profile)) parts.push(fenceBlock("PROFILE", profile))
  if (isNonEmpty(interests)) parts.push(fenceBlock("INTERESTS", interests))
  const { saves, dismissals, ingests } = activityCounts(events)
  parts.push(
    `Recent activity: ${events.length} events (${saves} saves, ${dismissals} dismissals, ${ingests} ingests in the window)`,
  )
  return parts.join("\n\n")
}

/** Assembles the fenced `text` block, truncating oldest event lines first, then library lines
 * from the end (oldest-created), until the total is within `MAX_TEXT_CHARS`. Never truncates
 * profile/interests/feedback. Returns the final text plus the number of event lines kept. */
function buildText(
  profile: string | null,
  interests: string | null,
  feedback: string | null,
  eventLines: string[],
  libraryLines: string[],
): { text: string; eventCount: number } {
  const fixedBlocks: string[] = []
  if (isNonEmpty(profile)) fixedBlocks.push(fenceBlock("PROFILE", profile))
  if (isNonEmpty(interests)) fixedBlocks.push(fenceBlock("INTERESTS", interests))
  if (isNonEmpty(feedback)) fixedBlocks.push(fenceBlock("STANDING-INSTRUCTIONS", feedback))

  let events = [...eventLines]
  let library = [...libraryLines]

  const assemble = (): string => {
    const blocks = [...fixedBlocks]
    if (events.length > 0) blocks.push(fenceBlock("RECENT-ACTIVITY", events.join("\n")))
    if (library.length > 0) blocks.push(fenceBlock("LIBRARY", library.join("\n")))
    return blocks.join("\n\n")
  }

  let text = assemble()
  // Drop oldest event lines first (index 0 = oldest, since events are ascending by ts).
  while (text.length > MAX_TEXT_CHARS && events.length > 0) {
    events = events.slice(1)
    text = assemble()
  }
  // Then drop library lines from the end (oldest-created, since library is sorted newest-first).
  while (text.length > MAX_TEXT_CHARS && library.length > 0) {
    library = library.slice(0, -1)
    text = assemble()
  }

  return { text, eventCount: events.length }
}

export async function buildUserContext(
  storage: VaultStorage,
  opts: { eventLimit?: number } = {},
): Promise<UserContext> {
  const eventLimit = opts.eventLimit ?? DEFAULT_EVENT_LIMIT

  const [userModel, events, libraryEntries] = await Promise.all([
    readUserModel(storage),
    readRecentEvents(storage, { limit: eventLimit }),
    loadLibraryEntries(storage),
  ])

  const eventLines = events.map(eventLine)
  const libraryLines = libraryEntries.map(libraryLine)

  const { text, eventCount } = buildText(
    userModel.profile,
    userModel.interests,
    userModel.feedback,
    eventLines,
    libraryLines,
  )
  const compactText = buildCompactText(userModel.profile, userModel.interests, events)

  return { text, compactText, eventCount }
}
