"use client"

import { useCallback, useEffect } from "react"
import { usePathname } from "next/navigation"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadFeed } from "@/lib/skills/feed"
import { readRecentEvents } from "@/lib/events/log"
import { reviewCount } from "@/lib/wiki/review-queue"
import { loadBundle } from "@/lib/vault/bundle"
import { loadSettings } from "@/lib/llm/settings"
import { runCompanion } from "@/lib/companion/run"
import { useCompanionStore } from "@/stores/companion-store"

/**
 * Client hook that wires the Research Companion (M7) into an app surface.
 *
 * On mount (and whenever the route changes) it assembles the deterministic
 * `TriggerState` from live app state — current route, feed cache presence,
 * recent Tier-1 events, open review-inbox count, and the wiki bundle — plus
 * the anti-Clippy session bookkeeping the companion store already tracks,
 * and asks `runCompanion` whether the companion should speak. A non-null
 * result is handed to the store, which shows the mascot bubble.
 *
 * Fire-and-forget: this never blocks render, never throws into the caller,
 * and never suspends. `runCompanion` itself already fails silent (see
 * src/lib/companion/run.ts), but the trigger-state assembly here (storage
 * open, feed/bundle/event reads) is wrapped too, since a companion failure
 * must never break the host page.
 *
 * Returns a `reevaluate` function so callers can nudge the companion after
 * an app event that just happened (e.g. a successful ingest) without
 * waiting for the next mount or route change.
 */
export function useCompanion(): () => void {
  const pathname = usePathname()
  // Only subscribe to the stable `show` action reference — sessionShownCount
  // and lastShownTs are read fresh via getState() inside the callback below
  // so this hook doesn't re-render its host component on every companion
  // event (they're only ever used inside the async callback, not render).
  const show = useCompanionStore((s) => s.show)

  const reevaluate = useCallback(() => {
    void (async () => {
      try {
        const storage = await getOpenVault()
        const { sessionShownCount, lastShownTs } = useCompanionStore.getState()

        const [feed, recentEvents, reviews, bundle, settings] = await Promise.all([
          loadFeed(storage),
          readRecentEvents(storage),
          reviewCount(storage),
          loadBundle(storage),
          loadSettings(storage),
        ])

        const utterance = await runCompanion({
          storage,
          state: {
            route: pathname ?? "/",
            hasFeedCache: feed !== null,
            recentEvents,
            reviewCount: reviews,
            bundle,
            lastShownTs,
          },
          sessionShownCount,
          settings,
        })

        if (utterance) show(utterance)
      } catch {
        // Fire-and-forget: a companion failure must never break the host page.
      }
    })()
  }, [pathname, show])

  useEffect(() => {
    reevaluate()
    // Re-evaluate automatically on mount and on route change only; callers
    // invoke the returned `reevaluate` directly for other app events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return reevaluate
}
