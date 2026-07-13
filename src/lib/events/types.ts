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
  | { type: "reader_open"; paperKey: string; title: string }
  | { type: "highlight_add"; paperKey: string; title: string }
  | { type: "reading_ask"; paperKey: string }
  | { type: "idea_captured"; paperKey: string; changesetId: string }
  | { type: "companion_shown"; trigger: string }
  | { type: "companion_dismiss"; trigger: string }
  | { type: "companion_action"; trigger: string }

export type LoggedEvent = SciSparkEvent & { ts: string } // ISO timestamp
