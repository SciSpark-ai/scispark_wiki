import type { VaultStorage } from "../vault/storage"
import { makeChangesetId } from "../vault/changesets"
import { commitChangeset } from "../vault/mutations"
import { FeedbackRecordSchema, FEEDBACK_PATH, type FeedbackReason } from "./contract"
import { loadFeed } from "../skills/feed-cache"
import { paperKey } from "../papers/types"
import { readRecommendationFeedback } from "./feedback-record"
import { readRecommendationPreferences } from "./contract"
import { createHash } from "node:crypto"
import type { FeedbackEntry } from "./contract"
import { resolvePaperByKey } from "../papers/resolve"
export { readRecommendationFeedback } from "./feedback-record"

export class RecommendationFeedbackError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

/** Accept only a persisted paper key. Never trust client-supplied titles, topics,
 * scores or timestamps. The vault changeset provides atomicity, conflicts and Undo. */
export const feedbackRevision = (entry: FeedbackEntry) => createHash("sha256").update(JSON.stringify(entry)).digest("hex")

export async function recordRecommendationFeedback(storage: VaultStorage, key: string, reason: FeedbackReason, now = new Date(), details: { note?: string; expectedRevision?: string | null } = {}) {
  const current = await readRecommendationFeedback(storage)
  if (current.warning) throw new RecommendationFeedbackError(current.warning, 409)
  const feed = await loadFeed(storage)
  const item = feed?.items.find((entry) => paperKey(entry.paper) === key)
  const previous = current.entries.find((entry) => entry.paperKey === key)
  // A follow-up may outlive its feed cache. Only the server's persisted snapshot
  // can supply that context; a stale bubble must not overwrite newer feedback.
  if (details.expectedRevision !== undefined && (previous ? feedbackRevision(previous) : null) !== details.expectedRevision) {
    throw new RecommendationFeedbackError("Your feedback changed elsewhere. Close this question and review your saved feedback in Settings.", 409)
  }
  const paper = item?.paper ?? await resolvePaperByKey(storage, key)
  if (!paper && !previous) throw new RecommendationFeedbackError("This paper could not be found. Reopen it before giving feedback.", 404)
  const preferences = readRecommendationPreferences(await storage.read("profile.md") ?? "")
  const note = details.note?.trim() ?? ""
  if (previous?.reason === reason && (previous.note ?? "") === note && (!preferences.resetAt || previous.at > preferences.resetAt)) {
    return { result: previous, revision: feedbackRevision(previous), learningEnabled: preferences.learnFromFeedback, changesetId: null, warnings: [] }
  }
  const result: FeedbackEntry = {
    paperKey: key, title: previous?.title ?? paper!.title.slice(0, 2000),
    topics: previous?.topics ?? item?.ranking?.matchedTopics ?? paper?.fields.slice(0, 20).map((field) => field.slice(0, 200)) ?? [], reason, at: now.toISOString(), note,
    abstract: previous?.abstract ?? paper?.abstract?.slice(0, 2000),
    fields: previous?.fields ?? paper?.fields.slice(0, 20).map((field) => field.slice(0, 200)),
    publicationDate: previous?.publicationDate ?? paper?.date?.slice(0, 30),
  }
  const entries = [...current.entries.filter((entry) => entry.paperKey !== key), result].slice(-2000)
  const record = FeedbackRecordSchema.parse({ version: 1, entries })
  const mutation = await commitChangeset(storage, {
    id: makeChangesetId(), skill: "recommendation-feedback", model: "none", timestamp: now.toISOString(),
    changes: [{ path: FEEDBACK_PATH, before: current.raw, after: `${JSON.stringify(record, null, 2)}\n` }],
  }, { op: "recommendation-feedback", summary: `${reason}: ${result.title}` })
  return { result, revision: feedbackRevision(result), learningEnabled: preferences.learnFromFeedback, ...mutation }
}

/** Clearing a vote is explicit and reversible, never a second negative signal. */
export async function clearRecommendationFeedback(storage: VaultStorage, key: string, expectedRevision: string) {
  const current = await readRecommendationFeedback(storage)
  if (current.warning) throw new RecommendationFeedbackError(current.warning, 409)
  const previous = current.entries.find((entry) => entry.paperKey === key)
  if (!previous || feedbackRevision(previous) !== expectedRevision) throw new RecommendationFeedbackError("Your feedback changed elsewhere. Reload it before clearing this vote.", 409)
  const record = FeedbackRecordSchema.parse({ version: 1, entries: current.entries.filter((entry) => entry.paperKey !== key) })
  const mutation = await commitChangeset(storage, {
    id: makeChangesetId(), skill: "recommendation-feedback", model: "none", timestamp: new Date().toISOString(),
    changes: [{ path: FEEDBACK_PATH, before: current.raw, after: `${JSON.stringify(record, null, 2)}\n` }],
  }, { op: "recommendation-feedback", summary: `Clear feedback: ${previous.title}` })
  return { result: null, ...mutation }
}
