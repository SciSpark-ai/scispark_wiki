import type { PaperRecord, SourceId } from "../papers/types"
import type { VaultStorage } from "../vault/storage"
import type { AnchorDiscipline } from "./anchors"
import { manualAnchorError } from "./anchors"
import { canonicalAnchor } from "./openalex-fields"
import { openAlexSubfield } from "./openalex-subfields"
import type { Cadence } from "./settings"
import type { TrendingBoard } from "./types"

/**
 * Structure version of `.scispark/trending/dashboard.json`. Bump whenever the
 * persisted shape changes; `loadBoard` treats every other version as a cold
 * start. Version 3 replaced weekly sparklines with prior counts. Version 4
 * changed growth and bar sizing to discipline-corpus shares. Version 5 uses
 * canonical field-ID scopes instead of label searches for all trend metrics.
 */
export const TRENDING_BOARD_VERSION = 5

export const DASHBOARD_CACHE_PATH = ".scispark/trending/dashboard.json"

const PAPER_SOURCES = new Set<SourceId>(["arxiv", "openalex", "s2", "pubmed"])

const DAY_MS = 24 * 60 * 60 * 1000
const CADENCE_MS: Record<Cadence, number> = { daily: DAY_MS, weekly: 7 * DAY_MS }

/**
 * Reads the cached board. Returns null — a cold start, never a crash — when the
 * file is missing, unparseable, or written by a different structure version
 * (notably the M10/v1.1 `{panels}` shape, which has no `version` field at all
 * and is still sitting on real users' disks).
 */
export async function loadBoard(storage: VaultStorage): Promise<TrendingBoard | null> {
  const raw = await storage.read(DASHBOARD_CACHE_PATH)
  if (raw == null) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== "object") return null
    if (parsed.version !== TRENDING_BOARD_VERSION) return null
    if (!Array.isArray(parsed.topics) || typeof parsed.generatedAt !== "string") return null
    return parsed as TrendingBoard
  } catch {
    return null
  }
}

export function isStale(board: TrendingBoard | null, cadence: Cadence, now: Date): boolean {
  if (board == null) return true
  const gen = new Date(board.generatedAt).getTime()
  if (Number.isNaN(gen)) return true
  return now.getTime() - gen >= CADENCE_MS[cadence]
}

/**
 * True iff the parent fields AND optional subfield sets match, regardless of
 * selection order. Detects a settings change (anchor edit,
 * reset-to-auto) that rescoped the board without a corresponding refresh — a
 * cache can be time-fresh but scope-stale, and showing a board for the wrong
 * anchors is actively misleading.
 */
export function anchorsMatchBoard(board: TrendingBoard | null, anchors: AnchorDiscipline[]): boolean {
  if (board == null) return false
  if (!Array.isArray(board.anchors) || manualAnchorError({ anchors: board.anchors }) || manualAnchorError({ anchors })) return false
  const identity = (anchor: AnchorDiscipline) => JSON.stringify([
    canonicalAnchor(anchor.id)!.id,
    (anchor.subfieldIds ?? []).map((id) => openAlexSubfield(id)!.id).sort(),
  ])
  const boardIds = new Set(board.anchors.map(identity))
  const ids = new Set(anchors.map(identity))
  if (boardIds.size !== ids.size) return false
  for (const id of ids) {
    if (!boardIds.has(id)) return false
  }
  return true
}

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
    // Old trend metrics need recomputing, but their paper records remain usable.
    if (!isRecord(parsed) || (parsed.version !== TRENDING_BOARD_VERSION && parsed.version !== 4)) return []

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
