import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { FieldPanelView } from "../FieldPanelView"
import type { FieldPanel } from "@/lib/trending/dashboard"
import type { FieldMetrics } from "@/lib/trending/metrics"

const METRICS: FieldMetrics = {
  paperCountRecent: 3,
  paperCountPrior: 2,
  pctChange: 0.5,
  weeklyVolume: [{ weekStart: "2026-07-06", count: 3 }],
  topMovers: [],
  topVenues: [],
}
const SURVEY = {
  notablePapers: [{ title: "Attention Redux", why: "sharp result" }],
  emergingTopics: [{ topic: "long-context", why: "momentum" }],
  momentum: "The field is accelerating.",
}
function panel(over: Partial<FieldPanel>): FieldPanel {
  return { field: { slug: "nlp", label: "NLP" }, metrics: METRICS, survey: null, generatedAt: "2026-07-15T00:00:00.000Z", ...over }
}

describe("FieldPanelView", () => {
  it("renders the survey narrative when present", () => {
    const html = renderToStaticMarkup(<FieldPanelView panel={panel({ survey: SURVEY })} />)
    expect(html).toContain("Attention Redux")
    expect(html).toContain("The field is accelerating.")
    expect(html).not.toContain("Couldn")
  })

  it("surfaces the surveyError reason (not a silent null) when the survey failed", () => {
    const html = renderToStaticMarkup(
      <FieldPanelView panel={panel({ survey: null, surveyError: "request timed out after 120000ms" })} />,
    )
    // The generic fallback line AND the concrete reason both show.
    expect(html).toContain("Couldn")
    expect(html).toContain("Reason:")
    expect(html).toContain("request timed out after 120000ms")
  })

  it("shows the generic fallback without a 'Reason:' line when there is no surveyError", () => {
    const html = renderToStaticMarkup(<FieldPanelView panel={panel({ survey: null })} />)
    expect(html).toContain("Couldn")
    expect(html).not.toContain("Reason:")
  })
})
