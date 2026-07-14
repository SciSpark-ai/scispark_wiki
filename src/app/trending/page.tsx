"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadSettings } from "@/lib/llm/settings"
import { browserSearchFn } from "@/lib/skills/feed"
import { readUserModel } from "@/lib/usermodel/pages"
import { deriveTrackedFields } from "@/lib/trending/fields"
import { loadTrendingSettings } from "@/lib/trending/settings"
import { loadDashboard, runTrendingDashboard, isStale, type TrendingDashboard } from "@/lib/trending/dashboard"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { FieldPanelView } from "@/components/trending/FieldPanelView"

type State =
  | { status: "loading" }
  | { status: "empty" } // no tracked fields
  | { status: "ready"; dashboard: TrendingDashboard }
  | { status: "error"; message: string }

function formatUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
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
  const started = useRef(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      const vault = await getOpenVault()
      const [settings, tSettings, userModel] = await Promise.all([
        loadSettings(vault),
        loadTrendingSettings(vault),
        readUserModel(vault),
      ])
      const fields = tSettings.fields.length > 0 ? tSettings.fields : deriveTrackedFields(userModel.interests)
      if (fields.length === 0) {
        setState({ status: "empty" })
        return
      }
      const dashboard = await runTrendingDashboard(vault, { fields, searchFn: browserSearchFn(), settings })
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
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const [tSettings, userModel, cached] = await Promise.all([
          loadTrendingSettings(vault),
          readUserModel(vault),
          loadDashboard(vault),
        ])
        const fields = tSettings.fields.length > 0 ? tSettings.fields : deriveTrackedFields(userModel.interests)
        if (fields.length === 0) {
          setState({ status: "empty" })
          return
        }
        if (cached) {
          // Stale-while-revalidate: show the cached dashboard immediately —
          // fresh or stale — so panels never disappear. A stale cache then
          // triggers a background refresh; the Refresh button's own
          // `refreshing` spinner is the in-progress indicator.
          setState({ status: "ready", dashboard: cached })
          if (isStale(cached, tSettings.cadence, new Date())) {
            await refresh()
          }
        } else {
          await refresh() // no cache at all → first load
        }
      } catch (err) {
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) })
      }
    })()
  }, [refresh])

  return (
    <div className="p-7">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">Trending in your fields</h1>
        {state.status === "ready" && (
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-muted-text">Updated {formatUpdated(state.dashboard.generatedAt)}</span>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-1.5 font-medium"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </div>

      {state.status === "loading" && (
        <p className="mt-6 text-[14px] text-muted-text">{refreshing ? "Gathering your fields’ trends…" : "Loading…"}</p>
      )}
      {state.status === "empty" && (
        <div className="mt-8 border border-border-warm rounded-card px-5 py-6 bg-light-surface max-w-lg">
          <h2 className="font-heading text-[18px] text-espresso tracking-heading-card">No tracked fields yet</h2>
          <p className="mt-2 text-[13px] text-muted-text tracking-body">
            Set your research areas to see what’s trending in them.
          </p>
          <Link href="/profile" className="mt-4 inline-block text-[13px] text-white bg-orange rounded-pill px-4 py-1.5 font-medium">
            Set my fields →
          </Link>
        </div>
      )}
      {state.status === "error" && (
        <div className="mt-6">
          <LlmErrorMessage message={state.message} />
          <button
            onClick={refresh}
            disabled={refreshing}
            className="mt-3 text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-1.5 font-medium"
          >
            {refreshing ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {state.status === "ready" && (
        <>
          {refreshError && (
            <div className="mt-3">
              <LlmErrorMessage message={refreshError} />
            </div>
          )}
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {state.dashboard.panels.map((panel) => (
              <FieldPanelView key={panel.field.slug} panel={panel} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
