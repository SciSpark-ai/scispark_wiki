"use client"

import { useState } from "react"
import Link from "next/link"
import type { Seed } from "@/lib/spark/quick"
import type { DeepSparkOutcome } from "@/lib/spark/deep"
import { quickSparkRemote, saveSeedRemote, deepSparkRemote, estimateRemote } from "@/lib/spark/client"
import { formatDeepSparkConfirm, describeDeepOutcome, isDevelopButtonDisabled } from "@/lib/spark/ui-format"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { SeedCard, type SeedSaveState } from "./SeedCard"
import { DeepProgress } from "./DeepProgress"
import { wikiHref } from "@/lib/wiki/href"

type QuickState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; seeds: Seed[]; costUsd: number }
  | { status: "error"; message: string }

type DeepRunState =
  | { status: "idle" }
  | { status: "running"; phase: string | null; seedIndex?: number }
  | { status: "done"; outcome: DeepSparkOutcome; costUsd: number; seedIndex?: number }
  | { status: "error"; message: string; seedIndex?: number }

interface SparkPanelProps {
  /** Pre-filled cluster page ids, e.g. from the companion's "Spark an idea"
   * action (`?cluster=` query param on /spark) — warm-starts the top-level
   * Quick/Deep Spark actions. Per-seed "Develop fully" always warm-starts
   * from that seed's own groundingPageIds instead. */
  clusterPageIds?: string[]
  /** Called after any changeset that adds/updates an idea page, so the host
   * page can refresh its IdeaGallery. */
  onIdeaSaved?: () => void
}

/**
 * The Spark UI: a direction textarea plus Quick Spark / Deep Spark actions.
 * Quick Spark renders 2-3 SeedCards inline; each seed can be Saved (a stub
 * idea page) or Developed fully (upgraded into a full Deep Spark idea page in
 * place). The top-level Deep Spark button runs the full pipeline directly off
 * the typed direction. Follows the settings/provider/search idiom from
 * src/app/papers/page.tsx and src/components/feed/FeedRefreshBar.tsx.
 */
export function SparkPanel({ clusterPageIds, onIdeaSaved }: SparkPanelProps) {
  const [direction, setDirection] = useState("")
  const [quickState, setQuickState] = useState<QuickState>({ status: "idle" })
  const [seedUi, setSeedUi] = useState<Record<number, SeedSaveState>>({})
  const [deepState, setDeepState] = useState<DeepRunState>({ status: "idle" })

  const quickBusy = quickState.status === "loading"
  const deepBusy = deepState.status === "running"
  const canRun = direction.trim().length > 0 && !quickBusy && !deepBusy

  /** Ensures `seed` has a saved idea page, reusing an already-saved one for
   * this index — returns its bare wiki id (no ".md"). Shared by the explicit
   * Save button and "Develop fully" (which must save first so Deep Spark has
   * a seedPageId to upgrade in place). */
  async function persistSeed(seed: Seed, index: number): Promise<string> {
    const existing = seedUi[index]
    if (existing?.status === "saved") return existing.pageId
    setSeedUi((prev) => ({ ...prev, [index]: { status: "saving" } }))
    const result = await saveSeedRemote(seed)
    const pageId = result.path.replace(/\.md$/, "")
    setSeedUi((prev) => ({ ...prev, [index]: { status: "saved", pageId } }))
    onIdeaSaved?.()
    return pageId
  }

  async function handleQuickSpark() {
    setQuickState({ status: "loading" })
    setSeedUi({})
    setDeepState({ status: "idle" })
    try {
      const result = await quickSparkRemote({ direction, clusterPageIds })
      setQuickState({ status: "done", seeds: result.seeds, costUsd: result.costUsd })
    } catch (err) {
      setQuickState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  async function handleSaveSeed(seed: Seed, index: number) {
    try {
      await persistSeed(seed, index)
    } catch (err) {
      setSeedUi((prev) => ({
        ...prev,
        [index]: { status: "error", message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }

  async function runDeep(opts: {
    direction: string
    clusterPageIds?: string[]
    seedPageId?: string
    seedIndex?: number
  }) {
    const costUsd = await estimateRemote()
    if (!window.confirm(formatDeepSparkConfirm(costUsd))) return

    setDeepState({ status: "running", phase: null, seedIndex: opts.seedIndex })
    try {
      const result = await deepSparkRemote(
        {
          direction: opts.direction,
          clusterPageIds: opts.clusterPageIds,
          seedPageId: opts.seedPageId,
        },
        (phase) => setDeepState((prev) => (prev.status === "running" ? { ...prev, phase } : prev)),
      )
      setDeepState({ status: "done", outcome: result.outcome, costUsd: result.costUsd, seedIndex: opts.seedIndex })
      if (result.outcome.kind === "idea") onIdeaSaved?.()
    } catch (err) {
      setDeepState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        seedIndex: opts.seedIndex,
      })
    }
  }

  async function handleDeepSpark() {
    await runDeep({ direction, clusterPageIds })
  }

  async function handleDevelopSeed(seed: Seed, index: number) {
    try {
      const seedPageId = await persistSeed(seed, index)
      await runDeep({
        direction: `${seed.title}: ${seed.hook}`,
        clusterPageIds: seed.groundingPageIds,
        seedPageId,
        seedIndex: index,
      })
    } catch (err) {
      setDeepState({ status: "error", message: err instanceof Error ? err.message : String(err), seedIndex: index })
    }
  }

  return (
    <div>
      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        placeholder="What direction should Spark explore? e.g. 'sparse attention for long-context retrieval'"
        rows={3}
        className="w-full text-[13px] text-espresso border border-border-warm rounded-card px-3 py-2 bg-light-surface"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleQuickSpark}
          disabled={!canRun}
          className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium disabled:opacity-50"
        >
          {quickBusy ? "Sparking…" : "Quick Spark"}
        </button>
        <button
          type="button"
          onClick={handleDeepSpark}
          disabled={!canRun}
          className="text-[13px] text-espresso rounded-pill border border-border-warm px-4 py-1.5 disabled:opacity-50"
        >
          Deep Spark
        </button>
        {clusterPageIds && clusterPageIds.length > 0 && (
          <span className="text-[12px] text-muted-text tracking-body">
            Pre-filled from {clusterPageIds.length} recently-added paper{clusterPageIds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {quickState.status === "error" && <LlmErrorMessage message={quickState.message} />}

      {quickState.status === "done" && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="text-[12px] text-muted-text tracking-body">
            {quickState.seeds.length} seed{quickState.seeds.length === 1 ? "" : "s"} · cost ≈ $
            {quickState.costUsd.toFixed(4)}
          </div>
          {quickState.seeds.map((seed, i) => (
            <SeedCard
              key={i}
              seed={seed}
              saveState={seedUi[i] ?? { status: "idle" }}
              onSave={() => handleSaveSeed(seed, i)}
              onDevelop={() => handleDevelopSeed(seed, i)}
              developBusy={deepState.status === "running" && deepState.seedIndex === i}
              developDisabled={isDevelopButtonDisabled(deepState.status, seedUi[i]?.status ?? "idle")}
            />
          ))}
        </div>
      )}

      {deepState.status === "running" && (
        <div className="mt-4 border border-border-warm rounded-card px-4 py-3 bg-light-surface">
          <div className="text-[13px] text-espresso font-medium">
            {deepState.seedIndex !== undefined ? "Developing idea fully…" : "Running Deep Spark…"}
          </div>
          <DeepProgress phase={deepState.phase} />
        </div>
      )}

      {deepState.status === "error" && <LlmErrorMessage message={deepState.message} />}

      {deepState.status === "done" && <DeepOutcomeCard outcome={deepState.outcome} costUsd={deepState.costUsd} />}
    </div>
  )
}

function DeepOutcomeCard({ outcome, costUsd }: { outcome: DeepSparkOutcome; costUsd: number }) {
  const display = describeDeepOutcome(outcome)
  return (
    <div className="mt-4 border border-border-warm rounded-card px-4 py-3 bg-light-surface">
      <div className="text-[13px] text-espresso font-medium">{display.heading}</div>
      <div className="mt-1 text-[13px]/[18px] text-espresso">{display.message}</div>
      {outcome.kind === "idea" && (
        <Link
          href={wikiHref(outcome.ideaPageId)}
          className="mt-2 inline-block text-[13px] text-orange hover:text-orange-light font-medium"
        >
          View idea page →
        </Link>
      )}
      <div className="mt-2 text-[12px] text-muted-text tracking-body">cost ≈ ${costUsd.toFixed(2)}</div>
    </div>
  )
}
