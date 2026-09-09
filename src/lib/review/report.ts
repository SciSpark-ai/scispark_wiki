import type { EvidenceRecord, ReportVersion, ReviewRun } from "./contracts"
import { coverageDisplayMarkdown } from "./coverage"

const bib = (value: string) => value.replace(/[\\{}%&#_$~^]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, " ")
const safeUrl = (value: string) => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : null } catch { return null } }
export function reviewReferences(evidence: EvidenceRecord[]) {
  return evidence.map((e) => {
    const p = e.paper
    const url = p.ids.doi ? `https://doi.org/${encodeURI(p.ids.doi)}` : p.ids.arxiv ? `https://arxiv.org/abs/${encodeURIComponent(p.ids.arxiv)}` : safeUrl(p.htmlUrl ?? p.oaUrl ?? "")
    return `[${e.id}] ${p.authors.map((a) => a.name).join(", ")}${p.year ? ` (${p.year})` : ""}. ${p.title}. ${p.venue ?? ""}${url ? ` ${url}` : ""} Access: ${e.access}.`
  }).join("\n\n")
}
export function exportReview(run: ReviewRun, version: ReportVersion, format: "markdown" | "bibtex") {
  const evidence = (version.evidence ?? run.evidence).filter((e) => version.sourceIds.includes(e.id))
  if (format === "markdown") return `${coverageDisplayMarkdown(version.markdown)}\n\n## References\n\n${reviewReferences(evidence)}\n`
  return evidence.map((e) => {
    const p = e.paper
    const fields = { title: p.title, author: p.authors.map((a) => a.name).join(" and "),
      year: p.year ? String(p.year) : undefined, journal: p.venue, doi: p.ids.doi,
      eprint: p.ids.arxiv, note: `${e.access}; retrieved ${e.retrievedAt.slice(0, 10)}` }
    return `@article{${run.id}_${e.id},\n${Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k} = {${bib(v!)}},`).join("\n")}\n}`
  }).join("\n\n")
}
