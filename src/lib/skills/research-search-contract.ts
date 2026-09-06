import type { PaperRecord, SourceId } from "../papers/types"

export const RESEARCH_SEARCH_SOURCES = ["arxiv", "openalex", "s2", "pubmed"] as const

export interface ResearchSearchPlanQuery {
  source: SourceId
  query: string
  rationale: string
}

export interface ResearchSearchPlan {
  interpretation: string
  sort: "relevance" | "date"
  fromDate: string | null
  queries: ResearchSearchPlanQuery[]
}

export interface ResearchSearchInput {
  query: string
  sources?: SourceId[]
}

export type ResearchSearchStage = "planning" | "searching" | "ranking"

export interface ResearchSearchItem {
  paper: PaperRecord
  score: number
  whyMatch: string
  foundBy: Array<{ source: SourceId; rationale: string }>
}

export interface ResearchSearchResult {
  query: string
  plan: ResearchSearchPlan
  items: ResearchSearchItem[]
  stats: { retrieved: number; deduplicated: number }
  costUsd: number
  warnings: string[]
}
