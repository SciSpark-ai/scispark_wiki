import type { FeedbackEntry, FeedbackReason } from "./contract"
export const FEEDBACK_CHANGED_EVENT = "scispark:feedback-changed"
export type SavedFeedback = FeedbackEntry & { revision?: string }
export function notifyFeedbackChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FEEDBACK_CHANGED_EVENT))
}

export async function loadRecommendationFeedback(): Promise<{ entries: SavedFeedback[]; warning: string | null }> {
  const response = await fetch("/api/recommendations/feedback")
  if (!response.ok) throw new Error("Recommendation feedback could not be loaded.")
  return response.json()
}

export async function sendRecommendationFeedback(paperKey: string, reason: FeedbackReason, details: { note?: string; expectedRevision?: string | null } = {}) {
  const response = await fetch("/api/recommendations/feedback", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperKey, reason, ...details }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Feedback could not be saved.")
  notifyFeedbackChanged()
  return result as { result: FeedbackEntry; revision: string; learningEnabled: boolean; changesetId: string | null; warnings: Array<{ message: string }> }
}

export async function clearRecommendationFeedbackRemote(paperKey: string, expectedRevision: string) {
  const response = await fetch("/api/recommendations/feedback", {
    method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperKey, expectedRevision }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Feedback could not be cleared.")
  notifyFeedbackChanged()
  return result as { warnings: Array<{ message: string }> }
}
