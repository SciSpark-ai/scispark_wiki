import type { RecommendationRun } from "@/lib/recommendation/contract"

const SOURCE_NAMES = { s2: "Semantic Scholar", pubmed: "PubMed", openalex: "OpenAlex", arxiv: "arXiv" } as const
type Source = keyof typeof SOURCE_NAMES

function warningSource(warning: string): Source | undefined {
  const prefix = warning.split(":", 1)[0].trim().toLowerCase()
  return (Object.keys(SOURCE_NAMES) as Source[]).find((source) => prefix === source || prefix === SOURCE_NAMES[source].toLowerCase())
}

/** Historical run provenance, never a source-health indicator. Render known
 * failure categories, not adapter strings which can contain private URLs. */
function coverageNotes(run: RecommendationRun) {
  const sources = new Set<Source>()
  for (const warning of run.warnings) {
    const source = warningSource(warning)
    if (source) sources.add(source)
  }
  for (const trace of run.retrieval) {
    if (trace.error && Object.hasOwn(SOURCE_NAMES, trace.source)) sources.add(trace.source as Source)
  }
  return [...sources].map((source) => {
    const traces = run.retrieval.filter((trace) => trace.source === source)
    const errors = [...traces.flatMap((trace) => trace.error ? [trace.error] : []),
      ...run.warnings.filter((warning) => warningSource(warning) === source)]
    const detail = errors.some((error) => /rate limit/i.test(error))
      ? "Some searches reached this source's request limit."
      : errors.some((error) => /(?:^|: )Access denied/i.test(error))
        ? "This source denied access to some searches."
        : errors.some((error) => /(?:^|: )Search timed out/i.test(error))
          ? "Some searches took too long to respond."
          : "Some searches did not complete."
    return { source, detail, partlyCompleted: traces.some((trace) => !trace.error) }
  })
}

export function FeedRunSummary({ run, generatedAt }: { run: RecommendationRun; generatedAt: string }) {
  const notes = coverageNotes(run)
  // Assessment/grounding warnings remain prominent: they affect how the user
  // should interpret these papers, unlike historical source diagnostics.
  const warnings = [...new Set(run.warnings.filter((warning) => !warningSource(warning)
    && !warning.startsWith("Venue metrics are unavailable")))]
  const date = new Date(generatedAt)
  const displayedDate = Number.isFinite(date.getTime()) ? date.toLocaleString() : "the previous refresh"
  return <section aria-label="Feed information" className="mt-4 space-y-2 text-[13px] text-muted-text">
    <p>Publication window: {run.fromDate} to {run.toDate}.</p>
    {warnings.map((warning) => <p key={warning} role="status">{warning}</p>)}
    {notes.length > 0 && <details key={generatedAt} className="group">
      <summary className="w-fit cursor-pointer rounded-sm underline decoration-border-warm underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange">
        Some searches were incomplete on the last refresh
      </summary>
      <div className="mt-3 space-y-2 border-l border-border-warm pl-4">
        <p>Feed generated <time dateTime={generatedAt}>{displayedDate}</time>.</p>
        <p>This is a record of that refresh, not a live source-status check.</p>
        <ul className="space-y-1">
          {notes.map(({ source, detail, partlyCompleted }) => <li key={source}>
            <span className="font-medium text-espresso">{SOURCE_NAMES[source]}:</span> {detail}
            {partlyCompleted && " Other searches to this source completed."}
          </li>)}
        </ul>
        <p>Refresh the feed to search again. Your current papers remain available.</p>
      </div>
    </details>}
  </section>
}
