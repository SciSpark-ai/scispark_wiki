import type { LoggedEvent } from "../events/types"
import type { Bundle } from "../vault/bundle"
import { resolveLink } from "../vault/bundle"
import type { WikiPage } from "../vault/types"
import { wikiHref } from "../wiki/href"

/**
 * Deterministic, LLM-free trigger engine (M7 design 04): pure functions over
 * app state decide WHETHER the companion should speak. No model call is
 * involved here — the companion skill (Task 3) only phrases WHAT to say,
 * and only after a trigger fires and the anti-Clippy gate (Task 5) passes.
 */

export interface TriggerState {
  /** Current app route, e.g. "/", "/papers", "/reader". */
  route: string
  /** Legacy compatibility only: a cached feed is not a proactive event. */
  hasFeedCache: boolean
  /**
   * Recent events, ascending by `ts` (oldest first, newest last) — the same
   * order `readRecentEvents` (M5) returns. Callers passing a differently-
   * ordered slice must sort it first; this module does not re-sort.
   */
  recentEvents: LoggedEvent[]
  /** Open review-inbox item count. */
  reviewCount: number
  reviews?: Array<{ id: string; createdAt: string; title: string }>
  /** Server-owned delivery history; never supplied by the browser. */
  consumedKeys?: ReadonlySet<string>
  /** Wiki bundle, for sparkable-cluster detection. Null when no bundle is loaded yet. */
  bundle: Bundle | null
  /** triggerId -> ISO timestamp it last fired, for cooldown bookkeeping. */
  lastShownTs: Record<string, string>
  /** Injected clock (ms since epoch) so evaluation is deterministic in tests. */
  nowMs: number
}

export interface FiredTrigger {
  id: string
  eventKey: string
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
  "literature-review-ready": 10 * MINUTE_MS,
  "post-ingest": MINUTE_MS,
  "review-pending": 10 * MINUTE_MS,
  "sparkable-cluster": 6 * HOUR_MS,
}

function evalLiteratureReviewReady(state: TriggerState): FiredTrigger | null {
  for (const event of [...state.recentEvents].reverse()) {
    if (event.type !== "literature_review_ready" || !fresh(state, event.ts)
      || !/^[A-Za-z0-9_-]{1,100}$/.test(event.sessionId) || state.consumedKeys?.has(`literature-review:${event.reviewId}`)) continue
    return { id: "literature-review-ready", eventKey: `literature-review:${event.reviewId}`, priority: PRIORITY.medium,
      cooldownMs: COOLDOWN_MS["literature-review-ready"], contextBlurb: `A requested literature-review draft is ready: ${event.title}`,
      templateUtterance: "Your literature-review draft is ready when you want to read it.", action: { label: "Open review", href: `/chat/${event.sessionId}` } }
  }
  return null
}

/** Window within which a completed ingest still counts as "just happened". */
const POST_INGEST_WINDOW_MS = 2 * MINUTE_MS

/** Minimum distinct recently-ingested papers required to consider a cluster "sparkable". */
const SPARK_MIN_PAPERS = 3
export const EVENT_MAX_AGE_MS = 7 * 24 * HOUR_MS

function fresh(state: TriggerState, timestamp: string, maxAge = EVENT_MAX_AGE_MS): boolean {
  const age = state.nowMs - Date.parse(timestamp)
  return Number.isFinite(age) && age >= 0 && age <= maxAge
}

function isEligibleByCooldown(state: TriggerState, id: string): boolean {
  const last = state.lastShownTs[id]
  if (last === undefined) return true // never shown -> eligible
  const lastMs = Date.parse(last)
  if (Number.isNaN(lastMs)) return true // corrupt timestamp -> treat as never shown
  return state.nowMs - lastMs >= COOLDOWN_MS[id]
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
    const eventKey = `ingest:${event.changesetId}`
    if (state.consumedKeys?.has(eventKey)) continue
    if (state.recentEvents.some((e) => e.type === "ingest_undo" && e.changesetId === event.changesetId)) continue
    const page = state.bundle && [...state.bundle.pages.values()].find((p) =>
      p.frontmatter.type === "paper" && p.frontmatter.title === event.title)
    if (!page) continue // No live destination (including undone/deleted papers).
    return {
      id: "post-ingest",
      eventKey,
      priority: PRIORITY.high,
      cooldownMs: COOLDOWN_MS["post-ingest"],
      contextBlurb: `The user just added the paper "${event.title}" to their knowledge base.`,
      templateUtterance: "Nice — that paper's in your knowledge base now.",
      action: { label: "View paper in Wiki", href: wikiHref(page.id) },
    }
  }
  return null
}

// ── review-pending ─────────────────────────────────────────────────────────

function evalReviewPending(state: TriggerState): FiredTrigger | null {
  if (state.reviewCount <= 0) return null
  const review = state.reviews?.find((item) => fresh(state, item.createdAt)
    && !state.consumedKeys?.has(`review:${item.id}:${item.createdAt}`))
  if (!review) return null
  return {
    id: "review-pending",
    eventKey: `review:${review.id}:${review.createdAt}`,
    priority: PRIORITY.medium,
    cooldownMs: COOLDOWN_MS["review-pending"],
    contextBlurb: `A new item needs the user's review: "${review.title}".`,
    templateUtterance: `An item needs your review: ${review.title}`,
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
function findSparkableCluster(bundle: Bundle, recentEvents: LoggedEvent[], state: TriggerState): FiredTrigger | null {
  const ingestTitles: string[] = []
  for (const event of recentEvents) {
    if (event.type === "ingest" && fresh(state, event.ts) && !ingestTitles.includes(event.title)
      && !recentEvents.some((e) => e.type === "ingest_undo" && e.changesetId === event.changesetId)) ingestTitles.push(event.title)
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
    const sortedIds = [...paperIds].sort()
    const eventKey = `cluster:${JSON.stringify([conceptId, sortedIds])}`
    if (state.consumedKeys?.has(eventKey)) continue
    return {
      id: "sparkable-cluster",
      eventKey,
      priority: PRIORITY.low,
      cooldownMs: COOLDOWN_MS["sparkable-cluster"],
      contextBlurb:
        `The user has recently added ${paperIds.size} papers that all connect to "${conceptTitle}", ` +
        "with no idea page linking that theme yet.",
      templateUtterance: `${paperIds.size} papers connect through ${conceptTitle}. Explore an idea?`,
      // The companion still only PROPOSES — the user clicks through to /spark
      // themselves. ?cluster= pre-fills the clustered papers as Spark's vault
      // warm-start (see src/lib/spark/quick.ts / grounding.ts clusterPageIds).
      action: { label: "Spark an idea", href: `/spark?cluster=${encodeURIComponent(sortedIds.join(","))}` },
    }
  }
  return null
}

function evalSparkableCluster(state: TriggerState): FiredTrigger | null {
  if (state.bundle === null) return null
  return findSparkableCluster(state.bundle, state.recentEvents, state)
}

// ── evaluateTriggers ───────────────────────────────────────────────────────

/**
 * Computes every trigger whose precondition holds AND whose cooldown has
 * elapsed, and returns the highest-priority one (or null when none are
 * eligible). Deterministic; no LLM, no storage, no I/O.
 */
export function evaluateTriggers(state: TriggerState): FiredTrigger | null {
  if (/^\/(?:onboarding|setup|chat|papers|settings)(?:\/|$)/.test(state.route)) return null
  const evaluators = [evalPostIngest, evalLiteratureReviewReady, evalReviewPending, evalSparkableCluster]
  const eligible = evaluators
    .map((evaluate) => evaluate(state))
    .filter((t): t is FiredTrigger => t !== null)
    .filter((t) => t.action?.href.split("?")[0] !== state.route.replace(/\/$/, ""))
    .filter((t) => isEligibleByCooldown(state, t.id))

  if (eligible.length === 0) return null

  return eligible.reduce((best, candidate) => (candidate.priority > best.priority ? candidate : best))
}

/** Viewing the destination consumes its currently relevant events without an
 * interruption. Leaving the inbox must not immediately recommend that inbox. */
export function viewedCompanionEvents(state: TriggerState): Array<{ key: string; trigger: string }> {
  const route = state.route.replace(/\/$/, "")
  if (route.startsWith("/chat/")) return state.recentEvents.flatMap((e) => e.type === "literature_review_ready" && fresh(state, e.ts) && route === `/chat/${e.sessionId}`
    ? [{ key: `literature-review:${e.reviewId}`, trigger: "literature-review-ready" }] : [])
  if (route === "/wiki/inbox") return (state.reviews ?? [])
    .filter((r) => fresh(state, r.createdAt))
    .map((r) => ({ key: `review:${r.id}:${r.createdAt}`, trigger: "review-pending" }))
  if (route !== "/spark" && !route.startsWith("/wiki/")) return []
  const viewed: Array<{ key: string; trigger: string }> = []
  const consumedKeys = new Set(state.consumedKeys)
  // Usually zero or one. Bound work even for malformed/very large bundles.
  for (let i = 0; i < 100; i++) {
    const candidate = route === "/spark"
      ? evalSparkableCluster({ ...state, consumedKeys })
      : evalPostIngest({ ...state, consumedKeys })
    if (!candidate) break
    consumedKeys.add(candidate.eventKey)
    if (candidate.action?.href.split("?")[0] === route) viewed.push({ key: candidate.eventKey, trigger: candidate.id })
  }
  return viewed
}
