import type { PaperRecord } from "./types"

// Preserve source vocabulary on the record; normalize only for comparisons.
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "")
const EXCLUDED = new Set([
  "peerreview", "reviewerreport", "supplementarymaterials", "supplement", "paratext",
  "editorial", "letter", "comment", "erratum", normalize("Published Erratum"),
  "retraction", "retractionofpublication", "retractedpublication", "expressionofconcern",
  "conferenceabstract", "bookreview", "libguides", "other",
])

/** Content eligibility is independent of relevance, feedback and model output.
 * Unknown metadata is not a reason to drop a genuine article. Old caches still
 * receive a conservative, anchored title check, never a broad /review/ ban. */
export function feedExclusionReason(paper: PaperRecord): string | null {
  if (paper.isRetracted) return "Retracted work"
  const excludedType = paper.publicationTypes?.find((type) => EXCLUDED.has(normalize(type)))
  if (excludedType) return `Non-article record: ${excludedType}`
  if (/^(?:reviewer\s*#?\s*\d+\s*\((?:public |peer )?review\)|(?:public |peer )review(?:er)?\s*(?:report|#\s*\d+)|referee report|author response|decision letter|supplementary (?:material|information|figures|tables)|supporting information)\s*(?::|for\b|to\b|of\b|$)/i.test(paper.title.trim())) {
    return "Review report or supporting record"
  }
  return null
}

export type PaperCategory = "Methods" | "Research findings" | "Review / synthesis" | "Data & tools"
export function paperCategory(paper: PaperRecord): PaperCategory {
  const types = (paper.publicationTypes ?? []).map(normalize)
  const abstract = paper.abstract ?? ""
  // Sources often call every preprint "preprint" and every journal item
  // "article". Explicit self-descriptions can refine these generic labels;
  // merely using a dataset or citing another review cannot.
  const contribution = abstract.match(/\b(?:we|this (?:paper|work|study))\s+(?:introduce[sd]?|present[sd]?|release[sd]?|propose[sd]?)\s+(?:[\w-]+,\s*)?(?:a|an|the|our)\s+(?:[\w-]+\s+){0,7}?(dataset|corpus|software (?:tool|package)|framework|method|pipeline|protocol)\b/i)?.[1]?.toLowerCase()
  if (types.some((type) => ["review", "systematicreview", "metaanalysis"].includes(type)) || /\b(?:systematic review|meta-analysis|scoping review)\b/i.test(paper.title) || /\bthis (?:mini |systematic |scoping |narrative )?review\b/i.test(abstract)) return "Review / synthesis"
  if (types.some((type) => ["dataset", "datapaper", "software", "softwarepaper"].includes(type)) || /\b(?:dataset|benchmark dataset|software tool)\b/i.test(paper.title) || contribution && /^(?:dataset|corpus|software)/.test(contribution)) return "Data & tools"
  if (/\b(?:a (?:new |novel )?(?:method|framework|pipeline)|methods? for|methodological|protocol for)\b/i.test(paper.title) || contribution) return "Methods"
  return "Research findings"
}

export function publicationLabel(paper: PaperRecord): string | null {
  const types = (paper.publicationTypes ?? []).map(normalize)
  if (types.includes("preprint") || paper.source === "arxiv" || /^(?:bioRxiv|medRxiv|Research Square)$/i.test(paper.venue ?? "")) return "Preprint"
  if (types.some((type) => ["conferencepaper", "conference", "proceedingsarticle"].includes(type))) return "Conference paper"
  return null
}
