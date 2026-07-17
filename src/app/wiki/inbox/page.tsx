"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { displayTitle } from "@/lib/papers/title"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listReviews, dismissReview, type ReviewItem } from "@/lib/wiki/review-queue"
import { loadBundle, resolveLink, type Bundle } from "@/lib/vault/bundle"
import {
  runLintDeterministicRemote,
  runLintLlmRemote,
  estimateLintCost,
  applyLintFixRemote,
} from "@/lib/lint/client"
import {
  formatDeepLintConfirm,
  formatDeepLintLabel,
  formatLintFindingCount,
  formatLintPairProgress,
  lintKindLabel,
} from "@/lib/lint/ui-format"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { wikiHref } from "@/lib/wiki/href"
import { PageHeader } from "@/components/ui/PageHeader"
import { Button } from "@/components/ui/Button"
import { LoadingState } from "@/components/ui/LoadingState"

const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  contradiction: "Contradiction",
  duplicate: "Duplicate",
  "missing-page": "Missing page",
  suggestion: "Suggestion",
  "lint-finding": "Lint",
}

type LintState =
  | { status: "idle" }
  | { status: "running-deterministic" }
  | { status: "running-deep"; progress?: { index: number; total: number } }
  | { status: "done"; count: number }
  | { status: "error"; message: string }

export default function WikiInboxPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [fixing, setFixing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lintState, setLintState] = useState<LintState>({ status: "idle" })
  const [deepEstimate, setDeepEstimate] = useState<number | null>(null)
  // Ids of items whose last Fix click came back "needs-manual" (see
  // applyLintFixRemote/applyLintFix): the vault changed since lint ran and
  // this finding is no longer mechanically fixable, but it's still real — the
  // item stays in the list (never dismissed) and this drives a small inline
  // notice on it, per the applyLintFix outcome contract in src/lib/lint/types.ts.
  const [needsManualIds, setNeedsManualIds] = useState<Set<string>>(new Set())

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const vault = await getOpenVault()
      const [reviews, b] = await Promise.all([listReviews(vault), loadBundle(vault)])
      setItems(reviews)
      setBundle(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // Loads the deep-lint cost estimate for the button label only (best-effort
  // — a failure here just leaves deepEstimate null, which formatDeepLintLabel
  // renders as the plain "Run deep lint" label, never a bare "~$"; the
  // confirm-dialog flow in handleDeepLint below re-fetches its own estimate
  // and is unaffected by this failing).
  useEffect(() => {
    estimateLintCost()
      .then(setDeepEstimate)
      .catch(() => setDeepEstimate(null))
  }, [])

  async function handleDismiss(id: string) {
    setDismissing(id)
    try {
      const vault = await getOpenVault()
      await dismissReview(vault, id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDismissing(null)
    }
  }

  /** Applies a lint finding's mechanical fix. `outcome` decides what happens
   * next (src/lib/lint/types.ts#LintFixOutcome):
   * - "applied"/"resolved": the item is done — dismiss it (applyLintFixRemote/
   *   applyLintFix does not itself archive the item — see src/lib/lint/run.ts —
   *   so this UI does it after a successful/no-op-but-resolved apply, per the
   *   task-10 brief).
   * - "needs-manual": the vault changed since lint ran and this finding got
   *   reclassified to advisory-only — it's still unresolved, so the item is
   *   NOT dismissed (dismissing it would make an unmerged duplicate silently
   *   disappear until the next lint run); instead a small notice is shown on
   *   it, per the C6 finding fix.
   */
  async function handleFix(id: string) {
    setFixing(id)
    try {
      const { outcome } = await applyLintFixRemote(id)
      if (outcome === "needs-manual") {
        setNeedsManualIds((prev) => new Set(prev).add(id))
        return
      }
      setNeedsManualIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      const vault = await getOpenVault()
      await dismissReview(vault, id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setFixing(null)
    }
  }

  /** Instant deterministic lint pass (orphans, broken links, bad frontmatter,
   * index drift) — writes findings straight to the inbox, no cost/confirm. */
  async function handleLintVault() {
    setLintState({ status: "running-deterministic" })
    try {
      const result = await runLintDeterministicRemote()
      setLintState({ status: "done", count: result.findings.length })
      await refresh()
    } catch (err) {
      setLintState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  /** LLM lint pass (contradictions/stale claims across page pairs) — costs
   * real money, so estimate → window.confirm → run, matching the Deep Spark
   * confirm idiom exactly (src/components/spark/SparkPanel.tsx#runDeep). */
  async function handleDeepLint() {
    setLintState({ status: "running-deep" })
    try {
      const costUsd = await estimateLintCost()
      if (!window.confirm(formatDeepLintConfirm(costUsd))) {
        setLintState({ status: "idle" })
        return
      }
      const result = await runLintLlmRemote((progress) =>
        setLintState((prev) =>
          prev.status === "running-deep" ? { ...prev, progress: { index: progress.index, total: progress.total } } : prev,
        ),
      )
      setLintState({ status: "done", count: result.findings.length })
      await refresh()
    } catch (err) {
      setLintState({ status: "error", message: err instanceof Error ? err.message : String(err) })
    }
  }

  const lintBusy = lintState.status === "running-deterministic" || lintState.status === "running-deep"

  return (
    <div className="p-7">
      <PageHeader
        title="Review inbox"
        actions={
          <>
            <Button onClick={handleLintVault} disabled={lintBusy}>
              {lintState.status === "running-deterministic" ? "Linting…" : "Lint vault"}
            </Button>
            <Button variant="secondary" onClick={handleDeepLint} disabled={lintBusy}>
              {lintState.status === "running-deep"
                ? lintState.progress
                  ? formatLintPairProgress(lintState.progress)
                  : "Estimating…"
                : formatDeepLintLabel(deepEstimate)}
            </Button>
            <Link href="/wiki" className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1">
              Back to wiki
            </Link>
          </>
        }
      />

      {lintState.status === "done" && (
        <p className="mt-3 text-[13px] text-muted-text tracking-body">
          Lint found {formatLintFindingCount(lintState.count)}.
        </p>
      )}
      {lintState.status === "error" && <LlmErrorMessage message={lintState.message} />}

      {error && (
        <div className="mt-4 border border-border-warm rounded-card px-3 py-2 bg-light-surface text-[13px] text-espresso">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] text-muted-text tracking-body">Nothing needs review right now.</p>
          <Link
            href="/wiki"
            className="mt-4 text-[14px] text-orange font-medium tracking-body hover:text-orange-light transition-colors"
          >
            Back to wiki →
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="border border-border-warm rounded-card px-3 py-2 bg-light-surface">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text">
                    {KIND_LABEL[item.kind]}
                  </span>
                  {item.lintKind && (
                    <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text">
                      {lintKindLabel(item.lintKind)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {(item.fix || item.fixes) && (
                    <Button
                      size="sm"
                      onClick={() => handleFix(item.id)}
                      disabled={fixing === item.id || dismissing === item.id}
                    >
                      {fixing === item.id ? "Fixing…" : "Fix"}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDismiss(item.id)}
                    disabled={dismissing === item.id || fixing === item.id}
                  >
                    {dismissing === item.id ? "Dismissing…" : "Dismiss"}
                  </Button>
                </div>
              </div>

              <div className="mt-2 font-heading text-[16px] text-espresso tracking-heading-card">{item.title}</div>
              <div className="mt-1 text-[13px]/[14px] text-muted-text">{item.description}</div>

              {needsManualIds.has(item.id) && (
                <p className="mt-1 text-[12px] text-muted-text/80">
                  The vault changed — this now needs a manual merge. Re-run Lint vault to refresh.
                </p>
              )}

              {item.pages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.pages.map((slug) => {
                    const page = bundle ? resolveLink(bundle, slug) : null
                    return page ? (
                      <Link key={slug} href={wikiHref(page.id)} className="text-[12px] text-orange hover:text-orange-light">
                        {displayTitle(String(page.frontmatter.title ?? ""))}
                      </Link>
                    ) : (
                      <Link
                        key={slug}
                        href="/wiki"
                        className="text-[12px] text-muted-text"
                        title="page not found in the current wiki — links to the wiki index"
                      >
                        {slug} (unresolved)
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
