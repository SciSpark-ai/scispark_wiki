import type { LoggedEvent } from "../events/types"
import type { Bundle } from "../vault/bundle"
import { resolveLink } from "../vault/bundle"
import type { WikiPage } from "../vault/types"

/**
 * Deterministic, LLM-free trigger engine (M7 design 04): pure functions over
 * app state decide WHETHER the companion should speak. No model call is
 * involved here — the companion skill (Task 3) only phrases WHAT to say,
 * and only after a trigger fires and the anti-Clippy gate (Task 5) passes.
 */

export interface TriggerState {
  /** Current app route, e.g. "/", "/papers", "/reader". */
  route: string
  /** A feed has been generated (feed cache present). */
  hasFeedCache: boolean
  /**
   * Recent events, ascending by `ts` (oldest first, newest last) — the same
   * order `readRecentEvents` (M5) returns. Callers passing a differently-
   * ordered slice must sort it first; this module does not re-sort.
   */
  recentEvents: LoggedEvent[]
  /** Open review-inbox item count. */
  reviewCount: number
  /** Wiki bundle, for sparkable-cluster detection. Null when no bundle is loaded yet. */
  bundle: Bundle | null
  /** triggerId -> ISO timestamp it last fired, for cooldown bookkeeping. */
  lastShownTs: Record<string, string>
  /** Injected clock (ms since epoch) so evaluation is deterministic in tests. */
  nowMs: number
}

export interface FiredTrigger {
  id: string
  /** Higher wins when several triggers are eligible at once. */
  priority: number
  cooldownMs: number
  /** Fed to the companion skill as triggerContext — what happened. */
  contextBlurb: string
  /** Zero-budget/template-fallback text, used when the LLM call is skipped or fails. */
  templateUtterance: string
  action: { label: string; href: string } | null
}

const PRIORITY = { high: 30, medium: 20, low: 10 } as const

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

const COOLDOWN_MS: Record<string, number> = {
  "post-ingest": MINUTE_MS,
  "review-pending": 10 * MINUTE_MS,
  "app-open": 30 * MINUTE_MS,
  "sparkable-cluster": 6 * HOUR_MS,
}

/** Window within which a completed ingest still counts as "just happened". */
const POST_INGEST_WINDOW_MS = 2 * MINUTE_MS

/** Minimum distinct recently-ingested papers required to consider a cluster "sparkable". */
const SPARK_MIN_PAPERS = 3

function isEligibleByCooldown(state: TriggerState, id: string): boolean {
  const last = state.lastShownTs[id]
  if (last === undefined) return true // never shown -> eligible
  const lastMs = Date.parse(last)
  if (Number.isNaN(lastMs)) return true // corrupt timestamp -> treat as never shown
  return state.nowMs - lastMs >= COOLDOWN_MS[id]
}

// ── app-open ───────────────────────────────────────────────────────────────

function evalAppOpen(state: TriggerState): FiredTrigger | null {
  if (state.route !== "/" || !state.hasFeedCache) return null
  return {
    id: "app-open",
    priority: PRIORITY.low,
    cooldownMs: COOLDOWN_MS["app-open"],
    contextBlurb: "The user opened the app to their home feed.",
    templateUtterance: "Your feed's ready — want to see what's new?",
    action: { label: "Home", href: "/" },
  }
}

// ── post-ingest ────────────────────────────────────────────────────────────

function evalPostIngest(state: TriggerState): FiredTrigger | null {
  // Walk from the newest event backward so the freshest qualifying ingest wins.
  for (let i = state.recentEvents.length - 1; i >= 0; i--) {
    const event = state.recentEvents[i]
    if (event.type !== "ingest") continue
    const eventMs = Date.parse(event.ts)
    if (Number.isNaN(eventMs)) continue
    const age = state.nowMs - eventMs
    if (age < 0 || age > POST_INGEST_WINDOW_MS) continue
    return {
      id: "post-ingest",
      priority: PRIORITY.high,
      cooldownMs: COOLDOWN_MS["post-ingest"],
      contextBlurb: `The user just added the paper "${event.title}" to their knowledge base.`,
      templateUtterance: "Nice — that paper's in your knowledge base now.",
      action: { label: "View wiki", href: "/wiki" },
    }
  }
  return null
}

// ── review-pending ─────────────────────────────────────────────────────────

function evalReviewPending(state: TriggerState): FiredTrigger | null {
  if (state.reviewCount <= 0) return null
  const n = state.reviewCount
  const plural = n === 1 ? "item" : "items"
  return {
    id: "review-pending",
    priority: PRIORITY.medium,
    cooldownMs: COOLDOWN_MS["review-pending"],
    contextBlurb: `The user has ${n} ${plural} waiting in their review inbox.`,
    templateUtterance: `You have ${n} ${plural} in your review inbox.`,
    action: { label: "Review inbox", href: "/wiki/inbox" },
  }
}

// ── sparkable-cluster ──────────────────────────────────────────────────────

/**
 * Concept-type pages a page links to, via typed frontmatter `related[]`
 * (resolved through the bundle's slug resolver) and via body wikilinks
 * (already resolved into `bundle.links`).
 */
function conceptLinksOf(bundle: Bundle, page: WikiPage): Set<string> {
  const ids = new Set<string>()
  for (const slug of page.frontmatter.related ?? []) {
    const target = resolveLink(bundle, slug)
    if (target && target.frontmatter.type === "concept") ids.add(target.id)
  }
  for (const link of bundle.links) {
    if (link.from !== page.id) continue
    const target = bundle.pages.get(link.to)
    if (target && target.frontmatter.type === "concept") ids.add(target.id)
  }
  return ids
}

/** All page ids an `idea` page already links to, via `related[]` or wikilinks (either direction). */
function ideaLinkedIds(bundle: Bundle, idea: WikiPage): Set<string> {
  const ids = new Set<string>()
  for (const slug of idea.frontmatter.related ?? []) {
    const target = resolveLink(bundle, slug)
    if (target) ids.add(target.id)
  }
  for (const link of bundle.links) {
    if (link.from === idea.id) ids.add(link.to)
    if (link.to === idea.id) ids.add(link.from)
  }
  return ids
}

/**
 * Detects a "sparkable cluster": at least SPARK_MIN_PAPERS distinct papers
 * ingested recently whose wiki pages share at least one linked concept, and
 * no `idea` page has already claimed that concept.
 *
 * Ingest events are matched to paper pages by title (the only field the
 * `ingest` event and a `paper`-type page's frontmatter both carry) — a paper
 * with no matching page (ingest still pending/failed) simply doesn't count.
 * Pure bundle computation; no LLM.
 */
function findSparkableCluster(bundle: Bundle, recentEvents: LoggedEvent[]): FiredTrigger | null {
  const ingestTitles: string[] = []
  for (const event of recentEvents) {
    if (event.type === "ingest" && !ingestTitles.includes(event.title)) ingestTitles.push(event.title)
  }
  if (ingestTitles.length < SPARK_MIN_PAPERS) return null

  const paperPages: WikiPage[] = []
  for (const title of ingestTitles) {
    const page = [...bundle.pages.values()].find(
      (p) => p.frontmatter.type === "paper" && p.frontmatter.title === title,
    )
    if (page) paperPages.push(page)
  }
  if (paperPages.length < SPARK_MIN_PAPERS) return null

  const conceptToPapers = new Map<string, Set<string>>()
  for (const page of paperPages) {
    for (const conceptId of conceptLinksOf(bundle, page)) {
      const set = conceptToPapers.get(conceptId) ?? new Set<string>()
      set.add(page.id)
      conceptToPapers.set(conceptId, set)
    }
  }

  const conceptsClaimedByIdeas = new Set<string>()
  for (const page of bundle.pages.values()) {
    if (page.frontmatter.type !== "idea") continue
    for (const id of ideaLinkedIds(bundle, page)) conceptsClaimedByIdeas.add(id)
  }

  for (const [conceptId, paperIds] of conceptToPapers) {
    if (paperIds.size < SPARK_MIN_PAPERS) continue
    if (conceptsClaimedByIdeas.has(conceptId)) continue
    const concept = bundle.pages.get(conceptId)
    const conceptTitle = concept?.frontmatter.title ?? conceptId
    return {
      id: "sparkable-cluster",
      priority: PRIORITY.low,
      cooldownMs: COOLDOWN_MS["sparkable-cluster"],
      contextBlurb:
        `The user has recently added ${paperIds.size} papers that all connect to "${conceptTitle}", ` +
        "with no idea page linking that theme yet.",
      templateUtterance: "Those papers share a theme — want to Spark an idea?",
      // The companion still only PROPOSES — the user clicks through to /spark
      // themselves. ?cluster= pre-fills the clustered papers as Spark's vault
      // warm-start (see src/lib/spark/quick.ts / grounding.ts clusterPageIds).
      action: { label: "Spark an idea", href: `/spark?cluster=${encodeURIComponent([...paperIds].join(","))}` },
    }
  }
  return null
}

function evalSparkableCluster(state: TriggerState): FiredTrigger | null {
  if (state.bundle === null) return null
  return findSparkableCluster(state.bundle, state.recentEvents)
}

// ── evaluateTriggers ───────────────────────────────────────────────────────

/**
 * Computes every trigger whose precondition holds AND whose cooldown has
 * elapsed, and returns the highest-priority one (or null when none are
 * eligible). Deterministic; no LLM, no storage, no I/O.
 */
export function evaluateTriggers(state: TriggerState): FiredTrigger | null {
  const evaluators = [evalPostIngest, evalReviewPending, evalAppOpen, evalSparkableCluster]
  const eligible = evaluators
    .map((evaluate) => evaluate(state))
    .filter((t): t is FiredTrigger => t !== null)
    .filter((t) => isEligibleByCooldown(state, t.id))

  if (eligible.length === 0) return null

  return eligible.reduce((best, candidate) => (candidate.priority > best.priority ? candidate : best))
}
