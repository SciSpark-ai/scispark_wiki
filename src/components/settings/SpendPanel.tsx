"use client"

import { useEffect, useState } from "react"
import { loadUsage } from "@/lib/llm/usage-client"
import { patchSettings } from "@/lib/llm/settings-client"
import type { UsageSummary } from "@/lib/llm/usage-summary"
import type { SkillAcceptance } from "@/lib/runs/acceptance"
import type { OrchestratorRunRecord } from "@/lib/runs/ledger"
import { spendBarLayout } from "./spend-chart"
import { relativeTime } from "./spend-time"

const CHART_WIDTH = 280
const CHART_HEIGHT = 64

function usd(n: number | null): string {
  if (n === null) return "Unknown"
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}

/** Just the month-day of a YYYY-MM-DD date, for compact axis labels. */
function shortDay(date: string): string {
  return date.slice(5)
}

function SpendBarChart({ days }: { days: UsageSummary["days"] }) {
  const bars = spendBarLayout(days, { width: CHART_WIDTH, height: CHART_HEIGHT })
  if (bars.length === 0) {
    return <p className="text-[13px] text-muted-text">No usage recorded yet.</p>
  }
  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT + 16}
      role="img"
      aria-label="Daily AI spend over the last 7 days"
      className="overflow-visible"
    >
      {bars.map((b) => (
        <g key={b.date}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={1.5} className="fill-orange">
            <title>{`${b.date}: ${usd(b.totalUsd)}`}</title>
          </rect>
          <text
            x={b.x + b.w / 2}
            y={CHART_HEIGHT + 12}
            textAnchor="middle"
            className="fill-muted-text"
            style={{ fontSize: 9 }}
          >
            {shortDay(b.date)}
          </text>
        </g>
      ))}
    </svg>
  )
}

/**
 * $/accepted cell: normally the skill's cost-per-accepted-change. When a
 * skill has spent real money but accepted zero changesets (applied: 0, or
 * every applied change was reverted), `costPerAcceptedUsd` is null by
 * construction (see summarizeAcceptance) — but the spend itself is real and
 * must not silently disappear behind a bare dash, so this falls back to the
 * skill's total spend in that case. Only a genuinely unmapped/unpriced skill
 * (totalCostUsd also null) renders as "—".
 */
function costCell(row: SkillAcceptance): string {
  if (row.costPerAcceptedUsd != null) return usd(row.costPerAcceptedUsd)
  if (row.totalCostUsd != null) return usd(row.totalCostUsd)
  return "—"
}

/** Tooltip for the totalCostUsd-fallback case only (costPerAcceptedUsd null,
 * totalCostUsd present) — clarifies that the shown number is total spend, not
 * a genuine per-accepted-change figure. Undefined for every other case (a real
 * $/accepted value, or the unpriced "—" case) so no misleading title appears. */
function costCellTitle(row: SkillAcceptance): string | undefined {
  if (row.costPerAcceptedUsd == null && row.totalCostUsd != null) {
    return "total spend (no accepted changesets)"
  }
  return undefined
}

export function AcceptanceTable({ acceptance }: { acceptance: SkillAcceptance[] }) {
  if (acceptance.length === 0) {
    return <p className="text-[13px] text-muted-text">No changesets yet.</p>
  }
  return (
    <table className="w-full text-[14px]">
      <thead>
        <tr className="border-b border-border-warm/20">
          <th className="py-1.5 text-left text-[12px] font-medium uppercase tracking-[0.06em] text-muted-text">
            Skill
          </th>
          <th className="py-1.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-muted-text">
            Applied
          </th>
          <th className="py-1.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-muted-text">
            Reverted
          </th>
          <th className="py-1.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-muted-text">
            Accept
          </th>
          <th className="py-1.5 text-right text-[12px] font-medium uppercase tracking-[0.06em] text-muted-text">
            $/accepted
          </th>
        </tr>
      </thead>
      <tbody>
        {acceptance.map((row) => (
          <tr key={row.skill} className="border-b border-border-warm/20 last:border-0">
            <td className="py-1.5 text-espresso">{row.skill}</td>
            <td className="py-1.5 text-right text-espresso tabular-nums">{row.applied}</td>
            <td className="py-1.5 text-right text-espresso tabular-nums">{row.reverted}</td>
            <td className="py-1.5 text-right text-espresso tabular-nums">
              {row.acceptRate == null ? "—" : `${Math.round(row.acceptRate * 100)}%`}
            </td>
            <td className="py-1.5 text-right text-espresso tabular-nums" title={costCellTitle(row)}>
              {costCell(row)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Status color: red for failed, muted for skipped, default espresso otherwise (ok/degraded). */
function statusClassName(status: OrchestratorRunRecord["status"]): string {
  if (status === "failed") return "text-red-600"
  if (status === "skipped") return "text-muted-text"
  return "text-espresso"
}

export function RecentRunsList({ runs, now }: { runs: OrchestratorRunRecord[]; now?: Date }) {
  if (runs.length === 0) {
    return <p className="text-[13px] text-muted-text">No runs recorded yet.</p>
  }
  // `runs` (from GET /api/usage's `recentRuns`, via readLedger) already comes
  // back newest-first, so "last 10" is just the first 10 of this list.
  const recent = runs.slice(0, 10)
  return (
    <ul className="space-y-1.5">
      {recent.map((run, i) => (
        <li key={`${run.ts}-${i}`} className="text-[13px] tracking-body text-espresso">
          <span className="font-medium">{run.orchestrator}</span>
          {" · "}
          <span className={statusClassName(run.status)}>{run.status}</span>
          {run.reason && (
            <>
              {" · "}
              <span className="text-muted-text">{run.reason}</span>
            </>
          )}
          {run.costUsd != null && (
            <>
              {" · "}
              <span className="text-muted-text">{usd(run.costUsd)}</span>
            </>
          )}
          {" · "}
          <span className="text-muted-text">{relativeTime(run.ts, now)}</span>
        </li>
      ))}
    </ul>
  )
}

export function SpendPanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [budgetUsd, setBudgetUsd] = useState<number>(0)
  const [budgetInput, setBudgetInput] = useState<string>("")
  const [acceptance, setAcceptance] = useState<SkillAcceptance[]>([])
  const [recentRuns, setRecentRuns] = useState<OrchestratorRunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const reload = async () => {
    setError(null)
    try {
      const { summary: s, budgetUsd: b, acceptance: a, recentRuns: r } = await loadUsage()
      setSummary(s)
      setBudgetUsd(b)
      setBudgetInput(String(b))
      setAcceptance(a)
      setRecentRuns(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const handleSaveBudget = async () => {
    const next = Number(budgetInput)
    if (!Number.isFinite(next) || next < 0) {
      setError("Budget must be a non-negative number.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await patchSettings({ dailyBudgetUsd: next })
      setBudgetUsd(next)
      setSaveStatus("Saved")
      setTimeout(() => setSaveStatus(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const todayUsd = summary ? summary.today.totalUsd : null
  const overBudget = todayUsd !== null && budgetUsd > 0 && todayUsd > budgetUsd
  const pct = todayUsd !== null && budgetUsd > 0 ? Math.min(100, (todayUsd / budgetUsd) * 100) : 0

  return (
    <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-[18px] text-espresso">AI spend</h2>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="text-[13px] text-muted-text hover:text-espresso rounded-pill border border-border-warm px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-[14px] text-muted-text">Loading…</p>
      ) : error && !summary ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : (
        <div className="space-y-6">
          {/* Today vs budget */}
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[13px] text-muted-text font-medium uppercase tracking-[0.06em]">
                Today
              </span>
              <span className={`text-[14px] font-medium ${overBudget ? "text-red-600" : "text-espresso"}`}>
                {usd(todayUsd)} / {usd(budgetUsd)}
              </span>
            </div>
            {todayUsd !== null && <div className="h-2.5 w-full rounded-pill bg-card-surface overflow-hidden">
              <div
                className={`h-full rounded-pill ${overBudget ? "bg-red-600" : "bg-orange"}`}
                style={{ width: `${overBudget ? 100 : pct}%` }}
              />
            </div>}
            {todayUsd === null && <p className="text-[12px] text-muted-text">Some calls have no known price. The local budget covers known costs only; check your provider’s spending limit.</p>}
            {overBudget && (
              <p className="mt-1.5 text-[12px] text-red-600">Over daily budget.</p>
            )}
          </div>

          {/* 7-day chart */}
          <div>
            <span className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
              Last 7 days
            </span>
            <SpendBarChart days={summary!.days} />
            {summary!.days.some((day) => day.totalUsd === null) && <p className="mt-2 text-[12px] text-muted-text">Unpriced days are not plotted.</p>}
          </div>

          {/* Per-skill breakdown for today */}
          <div>
            <span className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
              Today by skill
            </span>
            {summary!.today.bySkill.length === 0 ? (
              <p className="text-[13px] text-muted-text">No spend today.</p>
            ) : (
              <table className="w-full text-[14px]">
                <tbody>
                  {summary!.today.bySkill.map((row) => (
                    <tr key={row.skill} className="border-b border-border-warm/20 last:border-0">
                      <td className="py-1.5 text-espresso">{row.skill}</td>
                      <td className="py-1.5 text-right text-espresso tabular-nums">{usd(row.totalUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {summary!.unpricedCount > 0 && (
              <p className="mt-2 text-[12px] text-muted-text">
                {summary!.unpricedCount} record{summary!.unpricedCount === 1 ? "" : "s"} without a known
                price. Affected totals remain unknown, not zero.
              </p>
            )}
          </div>

          {/* Changeset acceptance */}
          <div>
            <span className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
              Changeset acceptance
            </span>
            <AcceptanceTable acceptance={acceptance} />
          </div>

          {/* Recent runs */}
          <div>
            <span className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
              Recent runs
            </span>
            <RecentRunsList runs={recentRuns} />
          </div>

          {/* Budget editor */}
          <div className="pt-2 border-t border-border-warm/20">
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Daily budget (USD)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-32 bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"
              />
              <button
                onClick={handleSaveBudget}
                disabled={saving}
                className="text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-2 font-medium transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {saveStatus && <span className="text-[13px] text-orange">{saveStatus}</span>}
            </div>
            {error && summary && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
