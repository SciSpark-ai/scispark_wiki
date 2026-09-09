import type { ScoreBreakdown } from "@/lib/recommendation/contract"

/** Translate recorded selection signals without a second persuasive AI call.
 * Scores and evidence traces remain in the server-owned feed record. */
export function RecommendationDetails({ ranking }: { ranking: ScoreBreakdown }) {
  const topics = ranking.matchedTopics.slice(0, 2)
  const relatedLike = ranking.memoryEffects?.some((effect) => effect.effect === "boost" && effect.adjustment > 0)
  const freshness = ranking.memoryEffects?.some((effect) => effect.effect === "freshness")
  if (ranking.confidence === "unranked") return <p className="text-[12px] leading-relaxed text-muted-text">Found in your search. Sparky hasn’t checked its fit yet.</p>
  return <details className="text-[12px] leading-relaxed text-muted-text" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <summary className="cursor-pointer text-espresso underline-offset-4 hover:underline">Why this paper?</summary>
    <div className="mt-2 space-y-2">
      <p>{topics.length ? `Selected for your interest in ${topics.join(" and ")}.` : "Matches the research preferences you shared with Sparky."}{relatedLike ? " It’s related to research you liked." : ""}{freshness ? " Your preference for newer work also shaped this selection." : ""}</p>
      <p>{ranking.confidence === "title-only" ? "Based on the title only; an abstract wasn’t available." : "Based on the title and abstract, not a full-text review."}</p>
    </div>
  </details>
}
