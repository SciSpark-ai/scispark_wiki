// Fictional deterministic responses, served only by the disposable E2E provider.
export function reviewResponse(messages) {
  const prefixes = ["Define the essential", "Assess coverage of EVERY", "Plan a bounded", "Assess whether", "Select one verbatim", "Extract a study", "Organize the provided", "Write one evidence", "Correct this draft", "Independently check", "Revise wording", "Connect the checked"]
  const prompt = messages?.map((m) => m.content).find((p) => typeof p === "string" && prefixes.some((prefix) => p.startsWith(prefix)))
  if (!prompt) return null
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1))
  if (prompt.startsWith("Define the essential")) return { requirements: [{ id: "R1", question: "What findings are reported?" }] }
  if (prompt.startsWith("Assess coverage of EVERY")) return { facets: data.requirements.map((r) => ({ requirementId: r.id, status: data.report !== undefined && !data.report.includes(data.evidence[0].text) ? "missing" : "addressed", explanation: "Coverage depends on whether the requested finding is in the evidence and answer.", evidence: [{ paperId: data.evidence[0].id, quote: data.evidence[0].text }], answerQuote: data.report === undefined || !data.report.includes(data.evidence[0].text) ? null : data.evidence[0].text })) }
  if (prompt.startsWith("Plan a bounded")) return { queries: [{ source: "openalex", query: "adult decoding" }] }
  if (prompt.startsWith("Assess whether")) return data.evidence.length > 1 ? { gaps: [], queries: [] } : { gaps: ["Conflicting findings"], queries: [{ source: "openalex", query: "null adult decoding", gap: "Conflicting findings" }] }
  if (prompt.startsWith("Select one verbatim")) return { quote: data.text }
  if (prompt.startsWith("Extract a study")) return { population: { value: null, quotes: [] }, methods: { value: null, quotes: [] }, findings: { value: data.paper.text, quotes: [data.paper.text] }, limitations: { value: null, quotes: [] } }
  if (prompt.startsWith("Organize the provided")) return { report_title: "Contrasting fixture findings", dimensions: [{ name: "Adult evidence", format: "synthesis", quotes: data.quotes.map((_, i) => i) }] }
  if (prompt.startsWith("Write one evidence")) return { paragraphs: data.evidence.map((e) => ({ text: e.sourceText, citations: [e.id] })) }
  if (prompt.startsWith("Correct this draft")) return { claims: [{ text: data.original.text, evidence: [{ paperId: data.original.citations[0], quote: data.original.text }] }], unresolved: [] }
  if (prompt.startsWith("Independently check")) return { checks: data.claims.map((_, i) => ({ claim: i, supported: true, explanation: "Exact fictional test evidence." })), missingSupportedFindings: [] }
  if (prompt.startsWith("Revise wording")) return { markdown: `${data.markdown}\n\n## Reading note\n\nEditorial fixture revision.`, requiresResearch: false }
  if (prompt.startsWith("Connect the checked")) return { markdown: "Consider how the contrasting results connect with your chosen methods. This is interpretive guidance." }
  return null
}
