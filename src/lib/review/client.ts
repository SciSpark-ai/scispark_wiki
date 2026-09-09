import { ReviewRunSchema, type ReviewAction } from "./contracts"
export async function prepareReview(input: { sessionId: string; operationId: string; question: string; sources: string[] }) {
  const response = await fetch("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Could not prepare review")
  return ReviewRunSchema.parse(result.run)
}
export async function readReview(id: string) {
  const response = await fetch(`/api/reviews/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Could not load review")
  return { run: ReviewRunSchema.parse(result.run), spending: result.spending as { spentUsd: number; heldUsd: number; uncertain: boolean } }
}
export async function changeReview(id: string, action: ReviewAction) {
  const response = await fetch(`/api/reviews/${encodeURIComponent(id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? "Could not update review")
  return result.result
}
