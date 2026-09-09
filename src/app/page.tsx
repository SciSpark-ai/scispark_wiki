"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { isOnboarded } from "@/lib/usermodel/pages"
import { loadFeed, type FeedResult } from "@/lib/skills/feed-cache"
import { loadRecommendationFeedback } from "@/lib/recommendation/client"
import { paperKey } from "@/lib/papers/types"
import { loadBundle } from "@/lib/vault/bundle"
import { paperRecordFromFrontmatter } from "@/lib/papers/resolve"
import { useUserStore } from "@/stores/user-store"
import type { VaultStorage } from "@/lib/vault/storage"
import { RealFeedCard } from "@/components/feed/RealFeedCard"
import { FeedRefreshBar } from "@/components/feed/FeedRefreshBar"
import { FeedRunSummary } from "@/components/feed/FeedRunSummary"
import { COMPANION_CLEARANCE } from "@/components/layout/companion-clearance"

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
  const user = useUserStore((state) => state.user)

  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [state, setState] = useState<PageState>({ status: "checking" })
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set())
  const [feedbackWarning, setFeedbackWarning] = useState<string | null>(null)

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
        const bundle = await loadBundle(vault)
        const persistedSavedKeys = new Set([...bundle.pages.values()].filter((page) => page.frontmatter.type === "paper").map((page) => paperKey(paperRecordFromFrontmatter(page.frontmatter))))
        const feedback = await loadRecommendationFeedback().catch(() => ({ entries: [], warning: "Saved feedback could not be loaded." }))
        // Keep rated papers in the existing feed, including after a reload.
        const hidden = new Set(feedback.entries.filter((entry) => entry.reason === "dismiss").map((entry) => entry.paperKey))
        if (feed) feed.items = feed.items.filter((item) => !hidden.has(paperKey(item.paper)))
        if (cancelled) return
        setFeedbackWarning(feedback.warning)
        setSavedKeys(persistedSavedKeys)
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

  const handleDismiss = useCallback(
    (key: string, notice?: string) => {
      if (!storage) return
      if (notice) setFeedbackWarning(notice)
      setState((prev) => {
        if (prev.status !== "ready" || !prev.feed) return prev
        const nextFeed: FeedResult = { ...prev.feed, items: prev.feed.items.filter((it) => paperKey(it.paper) !== key) }
        // The server has persisted undoable feedback. Keep the generated cache
        // intact so History Undo can reveal the paper again on reload.
        return { status: "ready", feed: nextFeed }
      })
    },
    [storage],
  )

  return (
    <div className={state.status === "not-onboarded"
      ? "flex min-h-full flex-col items-center justify-center px-5 py-16 text-center sm:px-8"
      : `p-7 ${COMPANION_CLEARANCE}`}>
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">{getGreeting()}{user?.name ? `, ${user.name}` : ""}</h1>

      {state.status === "checking" && <p className="mt-6 text-[14px] text-muted-text">Loading…</p>}

      {state.status === "error" && <p className="mt-6 text-[13px] text-red-600">Error: {state.message}</p>}

      {state.status === "not-onboarded" && (
        <div className="mt-6 w-full max-w-lg rounded-card border border-border-warm bg-light-surface px-5 py-6 sm:px-8 sm:py-8">
          <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">
            Set up your research profile to get a personalized feed
          </h2>
          <p className="mt-2 text-[13px] text-muted-text tracking-body">
            A short conversational setup tells SciSpark what you work on, so your feed can be tailored to you from
            the first refresh.
          </p>
          <Link
            href="/setup"
            className="mt-4 inline-block text-[13px] text-on-accent bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium"
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

          {feedbackWarning && <p role="status" className="mt-4 text-[13px] text-muted-text">{feedbackWarning}</p>}
          {state.feed?.recommendation && <FeedRunSummary run={state.feed.recommendation} generatedAt={state.feed.generatedAt} />}

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
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {state.feed.items.map((item, index) => (
                <div key={paperKey(item.paper)} className="contents">
                {item.ranking && (index === 0 || state.feed?.items[index - 1].ranking?.dateStatus !== item.ranking.dateStatus) && <h2 className="col-span-full mt-2 font-heading text-[20px] text-espresso">{item.ranking.dateStatus === "recent" ? "Recent papers" : item.ranking.dateStatus === "older" ? "Older papers you may have missed" : "Papers with unknown publication dates"}</h2>}
                <RealFeedCard
                  key={paperKey(item.paper)}
                  item={item}
                  storage={storage}
                  saved={savedKeys.has(paperKey(item.paper))}
                  onSave={handleSave}
                  onDismiss={handleDismiss}
                />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
