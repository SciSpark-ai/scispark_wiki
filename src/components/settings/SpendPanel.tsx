"use client"

import { useEffect, useState } from "react"
import { loadUsage } from "@/lib/llm/usage-client"
import { patchSettings } from "@/lib/llm/settings-client"
import type { UsageSummary } from "@/lib/llm/usage-summary"
import { spendBarLayout } from "./spend-chart"

const CHART_WIDTH = 280
const CHART_HEIGHT = 64

function usd(n: number): string {
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

export function SpendPanel() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [budgetUsd, setBudgetUsd] = useState<number>(0)
  const [budgetInput, setBudgetInput] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const reload = async () => {
    setError(null)
    try {
      const { summary: s, budgetUsd: b } = await loadUsage()
      setSummary(s)
      setBudgetUsd(b)
      setBudgetInput(String(b))
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

  const todayUsd = summary?.today.totalUsd ?? 0
  const overBudget = budgetUsd > 0 && todayUsd > budgetUsd
  const pct = budgetUsd > 0 ? Math.min(100, (todayUsd / budgetUsd) * 100) : 0

  return (
    <div className="bg-white rounded-[14px] border border-border-warm/30 p-6">
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
            <div className="h-2.5 w-full rounded-pill bg-card-surface overflow-hidden">
              <div
                className={`h-full rounded-pill ${overBudget ? "bg-red-600" : "bg-orange"}`}
                style={{ width: `${overBudget ? 100 : pct}%` }}
              />
            </div>
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
                price (excluded from totals).
              </p>
            )}
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
