import { mergeRecords, normalizeDoi, type PaperRecord } from "../papers/types"

function identifiers(paper: PaperRecord): string[] {
  const keys = Object.entries(paper.ids).filter(([, value]) => value?.trim())
    .map(([kind, value]) => `${kind}:${value!.trim().toLowerCase()}`)
  const doi = normalizeDoi(paper.ids.doi)
  const arxiv = paper.ids.arxiv ?? doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1]
  if (doi) keys.push(`doi:${doi}`)
  if (arxiv) keys.push(`arxiv:${arxiv.toLowerCase().replace(/v\d+$/, "")}`)
  // Do not merge independent studies just because their titles sound similar.
  if (!keys.length) keys.push(`title:${paper.title.normalize("NFKC").toLowerCase().trim()}`)
  return [...new Set(keys)]
}

export function sameReviewPaper(a: PaperRecord, b: PaperRecord): boolean {
  const keys = new Set(identifiers(a))
  return identifiers(b).some((id) => keys.has(id))
}

/** Cross-index identity matching, including arXiv DOI aliases and bridge records. */
export function deduplicateReviewPapers(papers: PaperRecord[]): PaperRecord[] {
  const groups: Array<{ paper: PaperRecord; keys: Set<string> }> = []
  for (const paper of papers) {
    const keys = new Set(identifiers(paper))
    const matches = groups.filter((group) => [...keys].some((id) => group.keys.has(id)))
    let merged = paper
    for (const match of matches) {
      merged = mergeRecords(match.paper, merged)
      for (const id of match.keys) keys.add(id)
      groups.splice(groups.indexOf(match), 1)
    }
    groups.push({ paper: merged, keys })
  }
  return groups.map((g) => g.paper)
}

/** Sample queries/sources evenly for a small engine trial; not a production stopping rule. */
export function interleaveEvidenceBatches(batches: PaperRecord[][]): PaperRecord[] {
  const results: PaperRecord[] = []
  const width = Math.max(0, ...batches.map((batch) => batch.length))
  for (let i = 0; i < width; i++) for (const batch of batches) if (batch[i]) results.push(batch[i])
  return results
}
