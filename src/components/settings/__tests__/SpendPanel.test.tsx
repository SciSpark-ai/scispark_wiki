import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { AcceptanceTable, RecentRunsList } from "../SpendPanel"
import type { SkillAcceptance } from "@/lib/runs/acceptance"
import type { OrchestratorRunRecord } from "@/lib/runs/ledger"

describe("AcceptanceTable", () => {
  it("shows the empty state when there are no acceptance rows", () => {
    const html = renderToStaticMarkup(<AcceptanceTable acceptance={[]} />)
    expect(html).toContain("No changesets yet.")
  })

  it("renders the accept percentage and cost-per-accepted for a normal row", () => {
    const rows: SkillAcceptance[] = [
      { skill: "ingest", applied: 4, reverted: 1, acceptRate: 0.75, totalCostUsd: 1.2, costPerAcceptedUsd: 0.4 },
    ]
    const html = renderToStaticMarkup(<AcceptanceTable acceptance={rows} />)
    expect(html).toContain("ingest")
    expect(html).toContain("75%")
    expect(html).toContain("$0.4000")
  })

  it("still surfaces total spend for an applied:0 row instead of hiding it behind a dash", () => {
    const rows: SkillAcceptance[] = [
      { skill: "spark-deep", applied: 0, reverted: 0, acceptRate: null, totalCostUsd: 0.5, costPerAcceptedUsd: null },
    ]
    const html = renderToStaticMarkup(<AcceptanceTable acceptance={rows} />)
    expect(html).toContain("spark-deep")
    expect(html).toContain("—") // accept rate has no meaning with 0 applied
    expect(html).toContain("$0.5000") // but the real spend must still be visible
  })

  it("renders a dash for both rate and cost when the skill is entirely unpriced", () => {
    const rows: SkillAcceptance[] = [
      { skill: "mystery", applied: 2, reverted: 0, acceptRate: 1, totalCostUsd: null, costPerAcceptedUsd: null },
    ]
    const html = renderToStaticMarkup(<AcceptanceTable acceptance={rows} />)
    expect(html).toContain("mystery")
    expect(html).toContain("100%")
    expect(html).toContain("—")
  })
})

describe("RecentRunsList", () => {
  it("shows the empty state when there are no runs", () => {
    const html = renderToStaticMarkup(<RecentRunsList runs={[]} />)
    expect(html).toContain("No runs recorded yet.")
  })

  it("surfaces the failure reason and colors a failed run red", () => {
    const runs: OrchestratorRunRecord[] = [
      {
        ts: "2026-07-19T00:00:00.000Z",
        orchestrator: "trending-refresh",
        trigger: "user",
        status: "failed",
        reason: "request timed out after 120000ms",
      },
    ]
    const html = renderToStaticMarkup(<RecentRunsList runs={runs} now={new Date("2026-07-19T00:05:00.000Z")} />)
    expect(html).toContain("trending-refresh")
    expect(html).toContain("request timed out after 120000ms")
    expect(html).toContain("text-red-600")
    expect(html).toContain("5m ago")
  })

  it("colors a skipped run muted and shows its cost when present", () => {
    const runs: OrchestratorRunRecord[] = [
      {
        ts: "2026-07-19T00:00:00.000Z",
        orchestrator: "feed-refresh",
        trigger: "schedule",
        status: "skipped",
        reason: "over budget",
        costUsd: 0.01,
      },
    ]
    const html = renderToStaticMarkup(<RecentRunsList runs={runs} now={new Date("2026-07-19T00:00:30.000Z")} />)
    expect(html).toContain("feed-refresh")
    expect(html).toContain("over budget")
    expect(html).toContain("$0.0100")
    expect(html).toContain("just now")
    expect(html).toContain("text-muted-text")
  })

  it("does not color an ok run red or muted", () => {
    const runs: OrchestratorRunRecord[] = [
      { ts: "2026-07-19T00:00:00.000Z", orchestrator: "ingest", trigger: "user", status: "ok" },
    ]
    const html = renderToStaticMarkup(<RecentRunsList runs={runs} now={new Date("2026-07-19T00:00:30.000Z")} />)
    expect(html).not.toContain("text-red-600")
  })

  it("shows only the last 10 runs", () => {
    const runs: OrchestratorRunRecord[] = Array.from({ length: 15 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 6, 19, 0, i)).toISOString(),
      orchestrator: "ingest" as const,
      trigger: "user" as const,
      status: "ok" as const,
    }))
    const html = renderToStaticMarkup(<RecentRunsList runs={runs} now={new Date(Date.UTC(2026, 6, 19, 1, 0))} />)
    expect((html.match(/ingest/g) ?? []).length).toBe(10)
  })
})
