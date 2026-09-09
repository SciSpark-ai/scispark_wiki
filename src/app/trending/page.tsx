"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { readUserModel } from "@/lib/usermodel/pages"
import { effectiveTrackedFields } from "@/lib/trending/fields"
import { loadTrendingSettingsRemote } from "@/lib/trending/settings-client"
import {
  loadBoard,
  isStale,
  anchorsMatchBoard,
} from "@/lib/trending/cache"
import type { TrendingBoard } from "@/lib/trending/types"
import { refreshTrendingDashboard } from "@/lib/trending/client"
import { useUIStore } from "@/stores/ui-store"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { Button } from "@/components/ui/Button"
import { LoadingState } from "@/components/ui/LoadingState"
import { OverviewStrip } from "@/components/trending/OverviewStrip"
import { TrendingWorkspace } from "@/components/trending/TrendingWorkspace"

type State =
  | { status: "loading" }
  | { status: "empty" } // no tracked fields
  | { status: "ready"; dashboard: TrendingBoard }
  | { status: "error"; message: string }

function formatUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  } catch {
    return iso
  }
}

export default function TrendingPage() {
  const [state, setState] = useState<State>({ status: "loading" })
  const [refreshing, setRefreshing] = useState(false)
  // Refresh outcome is tracked separately from `state` so a failed refresh
  // never wipes an already-displayed dashboard (see FeedRefreshBar/page.tsx
  // precedent: refresh errors stay local, old content remains visible with a
  // retry affordance).
  const [refreshError, setRefreshError] = useState<string | null>(null)
  // Fires with each anchor DISCIPLINE's label (not the user's narrow
  // interest fields — SP4 scopes retrieval to broad anchor disciplines).
  const [refreshingDiscipline, setRefreshingDiscipline] = useState<string | null>(null)
  const started = useRef(false)
  const openSettingsModal = useUIStore((s) => s.openSettingsModal)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const vault = await getOpenVault()
      const [tSettings, userModel] = await Promise.all([
        loadTrendingSettingsRemote(),
        readUserModel(vault),
      ])
      const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
      if (fields.length === 0 && tSettings.anchors.length === 0) {
        setState({ status: "empty" })
        return
      }
      const dashboard = await refreshTrendingDashboard(fields, (discipline) => setRefreshingDiscipline(discipline))
      setState({ status: "ready", dashboard })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // If a dashboard is already on screen, keep it visible and surface the
      // failure inline near the Refresh button instead of clobbering the
      // ready state. Only fall back to the full-page error state when there
      // was nothing to show in the first place (first load, no cache).
      setState((prev) => (prev.status === "ready" ? prev : { status: "error", message }))
      setRefreshError(message)
    } finally {
      setRefreshing(false)
      setRefreshingDiscipline(null)
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [tSettings, userModel, cached] = await Promise.all([
          loadTrendingSettingsRemote(),
          readUserModel(vault),
          loadBoard(vault),
        ])
        const fields = effectiveTrackedFields(tSettings.fields, userModel.interests)
        if (fields.length === 0 && tSettings.anchors.length === 0) {
          setState({ status: "empty" })
          return
        }
        // An EMPTY stored anchor list means "not derived yet" — there is
        // nothing to compare against, so scope-staleness doesn't apply.
        const scopeStale = tSettings.anchors.length > 0 && !anchorsMatchBoard(cached, tSettings.anchors)
        if (cached && !scopeStale) {
          // Stale-while-revalidate: show the cached board immediately —
          // fresh or stale — so the leaderboard never disappears. A stale
          // cache then triggers a background refresh; the Refresh button's own
          // `refreshing` spinner is the in-progress indicator.
          setState({ status: "ready", dashboard: cached })
          if (isStale(cached, tSettings.cadence, new Date())) {
            await refresh()
          }
        } else {
          // No cache at all (including an old-shaped one, which loadBoard
          // reports as a cold start), OR the cached board was built for a
          // different set of anchor disciplines. Unlike time-staleness, a
          // scope mismatch means the cached rows are for the WRONG scope —
          // showing them first would be actively misleading, so go through the
          // loading path instead of stale-while-revalidate.
          await refresh()
        }
      } catch (err) {
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
      }
    })()
  }, [refresh])

  return (
    <div className="px-4 py-6 pb-24 sm:p-7 sm:pb-24 lg:px-9">
      <header className="mb-6 flex flex-col justify-between gap-4 sm:mb-8 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-heading text-[32px] leading-tight text-espresso tracking-heading">Trending in your fields</h1>
          <p className="mt-2 text-[14px] text-secondary-dark">Research activity across the fields you follow.</p>
        </div>
        {state.status === "ready" && (
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => openSettingsModal("trending")}>Edit fields</Button>
              <Button onClick={refresh} disabled={refreshing}>
                {refreshing ? "Refreshing…" : "Refresh"}
              </Button>
            </div>
            <span className="text-[12px] text-muted-text">Updated {formatUpdated(state.dashboard.generatedAt)}</span>
            {refreshing && refreshingDiscipline && <span role="status" className="text-[12px] text-secondary-dark">Gathering trends… ({refreshingDiscipline})</span>}
          </div>
        )}
      </header>

      {state.status === "loading" && (
        <LoadingState
          label={
            refreshing
              ? refreshingDiscipline
                ? `Gathering your disciplines’ trends… (${refreshingDiscipline})`
                : "Gathering your disciplines’ trends…"
              : "Loading…"
          }
        />
      )}
      {state.status === "empty" && (
        <div className="mt-8 border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-lg">
          <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">Choose your Trending topics</h2>
          <p className="mt-2 text-[13px] text-muted-text tracking-body">
            Add broad topics to see what’s trending in them.
          </p>
          <Link href="/settings?section=trending" className="mt-4 inline-block text-[13px] text-on-accent bg-orange rounded-pill px-4 py-1.5 font-medium">
            Choose topics →
          </Link>
        </div>
      )}
      {state.status === "error" && (
        <div className="mt-6">
          <LlmErrorMessage message={state.message} />
          <Button onClick={refresh} disabled={refreshing} className="mt-3">
            {refreshing ? "Retrying…" : "Retry"}
          </Button>
          <Button variant="quiet" onClick={() => openSettingsModal("trending")} className="mt-3">Choose fields</Button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          {refreshError && (
            <div className="mb-4">
              <LlmErrorMessage message={refreshError} />
            </div>
          )}
          {state.dashboard.surveyError && (
            <p className="mb-4 text-[12px] text-muted-text tracking-body">
              AI-written summaries weren’t available from the previous refresh. Topic counts and papers are still
              available. Refresh to retry with your current AI settings.
            </p>
          )}
          {state.dashboard.dataError && (
            <p className="mb-4 text-[12px] text-muted-text tracking-body">
              Some activity data couldn’t be measured, so those topics are left off rather than guessed at. Reason:{" "}
              {state.dashboard.dataError}
            </p>
          )}
          <OverviewStrip overview={state.dashboard.overview} generatedAt={state.dashboard.generatedAt} />
          <TrendingWorkspace board={state.dashboard} />
        </>
      )}
    </div>
  )
}
