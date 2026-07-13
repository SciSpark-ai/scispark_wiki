"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { isOnboarded } from "@/lib/usermodel/pages"
import { loadFeed, FEED_CACHE_PATH, type FeedResult } from "@/lib/skills/feed"
import { paperKey } from "@/lib/papers/types"
import type { VaultStorage } from "@/lib/vault/storage"
import { RealFeedCard } from "@/components/feed/RealFeedCard"
import { FeedRefreshBar } from "@/components/feed/FeedRefreshBar"
import { useCompanion } from "@/components/companion/useCompanion"

type PageState =
  | { status: "checking" }
  | { status: "not-onboarded" }
  | { status: "ready"; feed: FeedResult | null }
  | { status: "error"; message: string }

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

function formatUpdatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function HomePage() {
  // App-open trigger (M7): home is the app's landing surface, so evaluating
  // the companion on mount here also catches "just came back after an
  // ingest/review" since the trigger engine looks at recent events, not just
  // the current route.
  useCompanion()

  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [state, setState] = useState<PageState>({ status: "checking" })
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        if (cancelled) return
        setStorage(vault)
        if (!(await isOnboarded(vault))) {
          setState({ status: "not-onboarded" })
          return
        }
        const feed = await loadFeed(vault)
        if (cancelled) return
        setState({ status: "ready", feed })
      } catch (err) {
        if (!cancelled) setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleFeedUpdated = useCallback((feed: FeedResult) => {
    setState({ status: "ready", feed })
  }, [])

  const handleSave = useCallback((key: string) => {
    setSavedKeys((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  // Serializes cache rewrites so rapid successive dismissals can't land out of
  // order and resurrect a dismissed card on the next reload.
  const cacheWriteChain = useRef<Promise<void>>(Promise.resolve())

  const handleDismiss = useCallback(
    (key: string) => {
      if (!storage) return
      setState((prev) => {
        if (prev.status !== "ready" || !prev.feed) return prev
        const nextFeed: FeedResult = { ...prev.feed, items: prev.feed.items.filter((it) => paperKey(it.paper) !== key) }
        cacheWriteChain.current = cacheWriteChain.current
          .then(() => storage.write(FEED_CACHE_PATH, JSON.stringify(nextFeed, null, 2)))
          .catch(() => undefined)
        return { status: "ready", feed: nextFeed }
      })
    },
    [storage],
  )

  return (
    <div className="p-7">
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">{getGreeting()}</h1>

      {state.status === "checking" && <p className="mt-6 text-[14px] text-muted-text">Loading…</p>}

      {state.status === "error" && <p className="mt-6 text-[13px] text-red-600">Error: {state.message}</p>}

      {state.status === "not-onboarded" && (
        <div className="mt-8 border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-lg">
          <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">
            Set up your research profile to get a personalized feed
          </h2>
          <p className="mt-2 text-[13px] text-muted-text tracking-body">
            A short conversational setup tells SciSpark what you work on, so your feed can be tailored to you from
            the first refresh.
          </p>
          <Link
            href="/onboarding"
            className="mt-4 inline-block text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium"
          >
            Set up my profile →
          </Link>
        </div>
      )}

      {state.status === "ready" && storage && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] text-muted-text tracking-body">
              {state.feed ? `Updated ${formatUpdatedAt(state.feed.generatedAt)}` : "No feed generated yet."}
            </div>
            <FeedRefreshBar storage={storage} onUpdated={handleFeedUpdated} />
          </div>

          {!state.feed || state.feed.items.length === 0 ? (
            <div className="mt-8 border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-lg">
              <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">
                Your feed is empty
              </h2>
              <p className="mt-2 text-[13px] text-muted-text tracking-body">
                Refresh to have the agent search for papers matching your profile and interests.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              {state.feed.items.map((item) => (
                <RealFeedCard
                  key={paperKey(item.paper)}
                  item={item}
                  storage={storage}
                  saved={savedKeys.has(paperKey(item.paper))}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
