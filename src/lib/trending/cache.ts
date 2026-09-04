import type { PaperRecord, SourceId } from "../papers/types"
import type { VaultStorage } from "../vault/storage"

/**
 * Structure version of `.scispark/trending/dashboard.json`. Bump whenever the
 * persisted shape changes; `loadBoard` treats every other version as a cold
 * start. Version 3 replaced weekly sparklines with prior counts. Version 4
 * changed growth and bar sizing to discipline-corpus shares.
 */
export const TRENDING_BOARD_VERSION = 4

export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"

const PAPER_SOURCES = new Set<SourceId>(["arxiv", "openalex", "s2", "pubmed"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Narrow runtime guard for records read from the derived trending cache. The
 * cache is disposable and may be hand-edited or partially corrupted, so paper
 * resolution must skip malformed entries rather than passing them to
 * `paperSlug`/`paperKey` and crashing a page.
 */
function isPaperRecord(value: unknown): value is PaperRecord {
  if (!isRecord(value) || !isRecord(value.ids)) return false
  if (typeof value.title !== "string" || !Array.isArray(value.authors) || !Array.isArray(value.fields)) return false
  if (typeof value.source !== "string" || !PAPER_SOURCES.has(value.source as SourceId)) return false
  return value.authors.every((author) => isRecord(author) && typeof author.name === "string")
    && value.fields.every((field) => typeof field === "string")
}

/**
 * Reads every valid paper record embedded in the current trending board.
 * This deliberately exposes only paper candidates—not the full dashboard or
 * its LLM orchestration—so client-side paper resolution stays browser-safe.
 */
export async function loadTrendingPaperRecords(storage: VaultStorage): Promise<PaperRecord[]> {
  const raw = await storage.read(DASHBOARD_CACHE_PATH)
  if (raw === null) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== TRENDING_BOARD_VERSION) return []

    const values: unknown[] = []
    if (Array.isArray(parsed.topics)) {
      for (const topic of parsed.topics) {
        if (!isRecord(topic) || !Array.isArray(topic.papers)) continue
        for (const paper of topic.papers) {
          if (isRecord(paper)) values.push(paper.record)
        }
      }
    }
    if (Array.isArray(parsed.breakouts)) {
      for (const breakout of parsed.breakouts) {
        if (isRecord(breakout)) values.push(breakout.record)
      }
    }

    return values.filter(isPaperRecord)
  } catch {
    return []
  }
}
