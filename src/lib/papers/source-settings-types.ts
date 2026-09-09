import type { SourceId } from "./types"

export const PAPER_SOURCE_IDS = ["arxiv", "openalex", "s2", "pubmed"] as const
export const PAPER_SOURCE_OPTIONS: { id: SourceId; label: string; description: string }[] = [
  { id: "arxiv", label: "arXiv", description: "Science & technology preprints" },
  { id: "openalex", label: "OpenAlex", description: "Research across disciplines" },
  { id: "s2", label: "Semantic Scholar", description: "Research across disciplines" },
  { id: "pubmed", label: "PubMed", description: "Biomedicine and life sciences" },
]

/** Browser-safe, deliberately key-free settings and connection results. */
export interface PaperSourceSettings {
  enabledSources: SourceId[]
  s2: PaperSourceStatus
}

export interface PaperSourceStatus {
  mode: "authenticated" | "anonymous"
  keySource: "vault" | "environment" | null
  savedKeyPresent: boolean
}

export interface SourceConnectionResult {
  outcome: "ok" | "missing_key" | "rate_limited" | "rejected" | "timeout" | "unavailable"
  message: string
}
