export type SciSparkEvent =
  | { type: "onboarding_completed" }
  | { type: "search"; source: string; query: string }
  | { type: "paper_view"; paperKey: string; title: string }
  | { type: "digest_generated"; paperKey: string; title: string; costUsd?: number }
  | { type: "ingest"; paperKey: string; title: string; changesetId: string }
  | { type: "ingest_undo"; changesetId: string }
  | { type: "feed_refresh"; itemCount: number; costUsd?: number }
  | { type: "feed_save"; paperKey: string; title: string }
  | { type: "feed_dismiss"; paperKey: string; title: string }
  | { type: "consolidation"; changesetId: string | null }

export type LoggedEvent = SciSparkEvent & { ts: string } // ISO timestamp
