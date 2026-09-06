import type { VaultStorage } from "../vault/storage"
import { FeedbackRecordSchema, FEEDBACK_PATH } from "./contract"

export async function readRecommendationFeedback(storage: VaultStorage) {
  const raw = await storage.read(FEEDBACK_PATH)
  if (raw === null) return { raw, entries: [], warning: null }
  try {
    return { raw, entries: FeedbackRecordSchema.parse(JSON.parse(raw)).entries, warning: null }
  } catch {
    return { raw, entries: [], warning: "Recommendation feedback is unreadable. Learning is paused; the original file has been preserved." }
  }
}
