export type SciSparkEvent =
  | { type: "literature_review_ready"; reviewId: string; sessionId: string; title: string }
  | { type: "onboarding_completed" }
  | { type: "search"; source: string; query: string; sort?: "relevance" | "date" }
  | { type: "paper_view"; paperKey: string; title: string }
  | { type: "digest_generated"; paperKey: string; title: string; costUsd?: number | null }
  | { type: "ingest"; paperKey: string; title: string; changesetId: string }
  | { type: "ingest_undo"; changesetId: string }
  | { type: "feed_refresh"; itemCount: number; costUsd?: number | null }
  | { type: "feed_save"; paperKey: string; title: string }
  | { type: "feed_dismiss"; paperKey: string; title: string }
  | { type: "consolidation"; changesetId: string | null }
  | { type: "reader_open"; paperKey: string; title: string }
  | { type: "highlight_add"; paperKey: string; title: string }
  | { type: "reading_ask"; paperKey: string }
  | { type: "idea_captured"; paperKey: string; changesetId: string }
  | { type: "companion_shown"; trigger: string; eventId?: string }
  | { type: "companion_dismiss"; trigger: string; eventId?: string }
  | { type: "companion_action"; trigger: string; eventId?: string }
  | { type: "spark_run"; mode: "quick" | "deep"; outcome: string; ideaPageId?: string; costUsd?: number | null }
  | { type: "trending_refresh"; fieldCount: number; costUsd?: number | null }
  | { type: "lint_run"; mode: "deterministic" | "llm"; findingCount: number; costUsd?: number | null }

export type LoggedEvent = SciSparkEvent & { ts: string } // ISO timestamp
