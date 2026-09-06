import { streamingSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { loadFeed } from "@/lib/skills/feed"
import { readRecentEvents } from "@/lib/events/log"
import { reviewCount } from "@/lib/wiki/review-queue"
import { loadBundle } from "@/lib/vault/bundle"
import { runCompanion, type CompanionUtterance } from "@/lib/companion/run"

export interface CompanionRouteInput {
  /** Current app route, e.g. "/", "/reader" — the one piece of `TriggerState` only the client knows. */
  route: string
  /** Anti-Clippy session bookkeeping the caller (client-side `useCompanionStore`) owns and reports each call. */
  sessionShownCount: number
  lastShownTs: Record<string, string>
}

/**
 * POST /api/skills/companion — body `CompanionRouteInput`. With NDJSON Accept,
 * streams provisional utterances without actions, followed by the validated
 * result. Existing JSON clients still receive
 * `CompanionUtterance | null` — the same shape `useCompanion` used to get
 * back from calling `runCompanion` directly.
 *
 * Everything `TriggerState` needs besides `route`/`lastShownTs` (feed-cache
 * presence, recent Tier-1 events, open review count, the wiki bundle) is now
 * read server-side from the vault here, rather than the hook assembling it
 * client-side via `Promise.all([loadFeed, readRecentEvents, reviewCount,
 * loadBundle, loadSettings])` — this collapses that whole block into one
 * request and, combined with `runCompanion` itself already owning the
 * chattiness budget/cooldown checks (`src/lib/companion/run.ts`), means the
 * hook no longer touches vault storage or LLM settings at all.
 *
 * `sessionShownCount`/`lastShownTs` MUST still come from the client: they are
 * per-tab session state (`useCompanionStore`, deliberately not persisted —
 * see that store's own doc comment), not vault-derived state.
 *
 * `runCompanion` never throws (documented fail-silent contract) and can
 * legitimately resolve to `null` (no trigger eligible, budget exhausted,
 * chattiness off) — `jsonSkillRoute` wraps that as `{result: null}`, a real
 * JSON `null`, not an absent field, so `companionUtteranceRemote` round-trips
 * it faithfully.
 */
export const POST = streamingSkillRoute<CompanionRouteInput, CompanionUtterance | null>(async (input, vault, emit) => {
  const overrides = getSkillTestOverrides()

  const [settings, feed, recentEvents, reviews, bundle] = await Promise.all([
    loadSettings(vault),
    loadFeed(vault),
    readRecentEvents(vault),
    reviewCount(vault),
    loadBundle(vault),
  ])

  return runCompanion({
    onText: emit ? (draft) => emit({ type: "text", draft }) : undefined,
    storage: vault,
    state: {
      route: input.route,
      hasFeedCache: feed !== null,
      recentEvents,
      reviewCount: reviews,
      bundle,
      lastShownTs: input.lastShownTs,
    },
    sessionShownCount: input.sessionShownCount,
    settings,
    providerOverride: overrides.providerOverride,
  })
})
