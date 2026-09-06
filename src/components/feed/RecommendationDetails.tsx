import type { ScoreBreakdown } from "@/lib/recommendation/contract"

export function RecommendationDetails({ ranking }: { ranking: ScoreBreakdown }) {
  return (
    <details className="mt-2 text-[12px] text-muted-text" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <summary className="cursor-pointer text-espresso underline-offset-4 hover:underline">Recommendation details</summary>
      <div className="mt-3 space-y-2 leading-relaxed">
        <p>{ranking.total === null ? "Unranked search result" : `Recommendation score ${ranking.total}/100. This is not a probability or a research-quality assessment.`}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt>Relevance · 70%</dt><dd>{ranking.relevance ?? "Not assessed"}</dd>
          <dt>Recency · 20%</dt><dd>{ranking.recency ?? "Unknown date"}</dd>
          <dt>Venue · 10%</dt><dd>{ranking.venue?.score ?? "Unknown · neutral"}</dd>
          <dt>Feedback adjustment</dt><dd>{ranking.feedbackAdjustment > 0 ? "+" : ""}{ranking.feedbackAdjustment}</dd>
        </dl>
        {ranking.recencyHalfLifeDays !== undefined && ranking.recencyHalfLifeDays < 14 && <p>Freshness preference applied to this subject: {ranking.recencyHalfLifeDays}-day half-life instead of 14 days.</p>}
        {Boolean(ranking.memoryEffects?.length) && <section aria-label="Applied feed memory" className="space-y-2">
          <p className="font-medium text-espresso">Applied feed memory</p>
          {ranking.memoryEffects!.map((effect) => <div key={effect.paperKey} className="space-y-1">
            <p>{effect.facet === "approach" ? "Method / population" : effect.facet === "recency" ? "Freshness" : effect.facet === "topic" ? "Topic" : "Similar research"} · {effect.adjustment > 0 ? "+" : ""}{effect.adjustment} points{effect.effect === "freshness" ? " in recency" : ""}</p>
            <p>Saved evidence: “{effect.memoryEvidence}”</p>
            <p>Paper evidence: “{effect.candidateEvidence}”</p>
            <p className="break-words">Feedback: {effect.paperKey} · {new Date(effect.at).toLocaleDateString()}</p>
          </div>)}
          <p>These excerpts show the basis of the match, not a guarantee that the AI interpreted it correctly.</p>
        </section>}
        <p>{ranking.confidence === "abstract" ? "Assessed from title and abstract, not full text." : ranking.confidence === "title-only" ? "Title-only assessment: abstract unavailable." : "AI assessment was unavailable. Preferences have not been fully checked."}</p>
        {ranking.venue && <p>Venue metric: <a href={ranking.venue.url} target="_blank" rel="noopener noreferrer" className="text-orange underline">{ranking.venue.source}</a> · {ranking.venue.metric}, {ranking.venue.year}, {ranking.venue.cohort}</p>}
        {ranking.assessment?.matches.map((match, index) => <p key={`${match.topic}-${index}`}><span className="font-medium text-espresso">{match.topic}:</span> “{match.evidence}”</p>)}
        <p>Sources: {ranking.sources.join(", ")}</p>
        <p>Searches: {ranking.queries.join("; ")}</p>
      </div>
    </details>
  )
}
