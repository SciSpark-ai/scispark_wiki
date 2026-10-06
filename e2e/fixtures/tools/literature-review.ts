/** Invented evidence corpus: offline scientific checks, never participant validation. */
export const reviewCorpus = [
  { id: "a1", strand: "methods", access: "full-text", passage: "In 40 synthetic records, method A achieved 80% accuracy on benchmark X.", claim: "Method A achieved 80% on benchmark X in 40 synthetic records." },
  { id: "a2", strand: "methods", access: "full-text", passage: "In 40 synthetic records, method B achieved 70% accuracy on benchmark X.", claim: "Method B achieved 70% on benchmark X in 40 synthetic records." },
  { id: "a3", strand: "methods", access: "abstract", passage: "The abstract reports faster inference for method A; timing details were not available.", claim: "An abstract reports faster inference for A without available timing details." },
  { id: "b1", strand: "robustness", access: "full-text", passage: "On noisy benchmark Y, method A scored 55% and method B scored 75%.", claim: "B outperformed A on noisy benchmark Y, 75% versus 55%." },
  { id: "b2", strand: "robustness", access: "abstract", passage: "The abstract describes a domain shift study but reports no numerical result.", claim: "A domain shift abstract supplies no numerical result." },
  { id: "b3", strand: "robustness", access: "missing", passage: "", claim: "" },
] as const
export const fixtureReport = {
  sourceIds: reviewCorpus.filter(p => p.access !== "missing").map(p => p.id),
  claims: reviewCorpus.filter(p => p.claim).map(p => ({ text: p.claim, sourceId: p.id, passage: p.passage, access: p.access })),
  unsupportedComparisons: ["clinical performance"],
  contradictions: ["A leads B on X; B leads A on noisy Y. Different benchmarks prevent a pooled ranking."],
  coverage: { "benchmark accuracy": "supported", "robustness": "partial", "clinical performance": "unsupported" },
  missingSources: ["b3"],
}
/** Independent, hand-authored exact claim/passage key for this tiny invented corpus.
 * Matching a quote alone cannot establish entailment; claims must match the key too. */
export function checkFixtureScience(report: typeof fixtureReport): void {
  if (report.sourceIds.some(id => !reviewCorpus.filter(p => p.access !== "missing").some(p => p.id === id))) throw new Error("Unknown or unavailable source")
  const expected = reviewCorpus.filter(p => p.claim)
  if (report.claims.length !== expected.length || expected.some(p => report.claims.filter(c => c.sourceId === p.id).length !== 1)) throw new Error("Incomplete or duplicate claim sampling")
  for (const claim of report.claims) {
    const paper = reviewCorpus.find(p => p.id === claim.sourceId)
    if (!paper || claim.text !== paper.claim || claim.passage !== paper.passage || claim.access !== paper.access) throw new Error("Unsupported claim or passage")
  }
  if (!report.unsupportedComparisons.includes("clinical performance") || report.coverage["clinical performance"] !== "unsupported" || report.coverage.robustness !== "partial" || report.coverage["benchmark accuracy"] !== "supported") throw new Error("Comparison coverage is not honest")
  if (!report.missingSources.includes("b3") || report.contradictions[0] !== fixtureReport.contradictions[0]) throw new Error("Missing contradiction or source limitation")
}
