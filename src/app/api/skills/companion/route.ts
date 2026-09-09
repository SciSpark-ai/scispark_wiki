import { streamingSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { readRecentEvents } from "@/lib/events/log"
import { listReviews } from "@/lib/wiki/review-queue"
import { loadBundle } from "@/lib/vault/bundle"
import { runCompanion, type CompanionUtterance } from "@/lib/companion/run"
import { z } from "zod"

export interface CompanionRouteInput {
  /** Current app route, e.g. "/", "/reader" — the one piece of `TriggerState` only the client knows. */
  route: string
  /** Optional legacy limits can further suppress delivery, never reset it. */
  sessionShownCount?: number
  lastShownTs?: Record<string, string>
}

/**
 * POST /api/skills/companion — body `CompanionRouteInput`. With NDJSON Accept,
 * streams provisional utterances without actions, followed by the validated
 * result. Existing JSON clients still receive
 * `CompanionUtterance | null` — the same shape `useCompanion` used to get
 * back from calling `runCompanion` directly.
 *
 * Events, review identities, wiki destinations and settings are read only
 * on the server. The browser reports its route, not notification candidates.
 *
 * Delivery history and frequency limits are server-owned and persisted per
 * vault. Legacy client counts can only further suppress a message, never
 * reset that history. Cached-feed presence is not a proactive event.
 *
 * `runCompanion` never throws (documented fail-silent contract) and can
 * legitimately resolve to `null` (no trigger eligible, budget exhausted,
 * chattiness off) — `jsonSkillRoute` wraps that as `{result: null}`, a real
 * JSON `null`, not an absent field, so `companionUtteranceRemote` round-trips
 * it faithfully.
 */
export const POST = streamingSkillRoute<CompanionRouteInput, CompanionUtterance | null>(async (input, vault, emit) => {
  const parsed = z.object({
    route: z.string().max(2048).regex(/^\/(?!\/)[^\r\n]*$/),
    sessionShownCount: z.number().int().nonnegative().optional().default(0),
    lastShownTs: z.record(z.string(), z.string()).optional().default({}),
  }).safeParse(input)
  if (!parsed.success) return null
  const request = parsed.data
  if (/^\/(?:onboarding|setup|chat|settings)(?:\/|$)/.test(request.route)) return null
  const overrides = getSkillTestOverrides()

  const [settings, recentEvents, reviews, bundle] = await Promise.all([
    loadSettings(vault),
    readRecentEvents(vault),
    listReviews(vault).catch(() => []),
    loadBundle(vault),
  ])

  return runCompanion({
    onText: emit ? (draft) => emit({ type: "text", draft }) : undefined,
    storage: vault,
    state: {
      route: request.route,
      hasFeedCache: false,
      recentEvents,
      reviewCount: reviews.length,
      reviews: reviews.filter((r) => r && typeof r.id === "string" && typeof r.createdAt === "string" && typeof r.title === "string"),
      bundle,
      lastShownTs: request.lastShownTs,
    },
    sessionShownCount: request.sessionShownCount,
    settings,
    providerOverride: overrides.providerOverride,
  })
})
