import type { FeedbackEntry, FeedbackReason } from "./contract"

export async function loadRecommendationFeedback(): Promise<{ entries: FeedbackEntry[]; warning: string | null }> {
  const response = await fetch("/api/recommendations/feedback")
  if (!response.ok) throw new Error("Recommendation feedback could not be loaded.")
  return response.json()
}

export async function sendRecommendationFeedback(paperKey: string, reason: FeedbackReason, details: { note?: string; expectedRevision?: string } = {}) {
  const response = await fetch("/api/recommendations/feedback", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paperKey, reason, ...details }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Feedback could not be saved.")
  return result as { result: FeedbackEntry; revision: string; learningEnabled: boolean; changesetId: string | null; warnings: Array<{ message: string }> }
}
