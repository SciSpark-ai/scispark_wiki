import type { VaultStorage } from "../vault/storage"
import { loadBundle } from "../vault/bundle"
import { readUserModel } from "../usermodel/pages"
import { getProject } from "../projects/repository"
import { selectFeedPreferenceMemory } from "../usermodel/feed-memory"
import { readRecommendationPreferences } from "../recommendation/contract"
import { readRecommendationFeedback } from "../recommendation/feedback-record"
import { hashReviewData } from "./budget"
import type { ReviewBrief } from "./contracts"
import { loadSession } from "../chat/session"
import { paperRecordFromFrontmatter } from "../papers/resolve"

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  .filter((s) => !["the", "and", "for", "with", "paper", "review", "research", "study"].includes(s)))
export const contextOverlap = (a: string, b: string) => [...words(a)].filter((w) => words(b).has(w)).length

/** Canonical profile + selected preferences + current project members only.
 * Never scans past chat transcripts or uses feed suppression as a review filter. */
export async function reviewContext(storage: VaultStorage, question: string, projectId?: string): Promise<ReviewBrief["context"]> {
  const result: ReviewBrief["context"] = []
  const model = await readUserModel(storage)
  const add = (id: string, label: string, text: string, kind: ReviewBrief["context"][number]["kind"]) => {
    const bounded = text.slice(0, 2500)
    result.push({ id, label, text: bounded, kind, hash: hashReviewData(bounded) })
  }
  for (const [name, raw] of Object.entries(model)) {
    if (!raw) continue
    const relevant = String(raw).split(/\n\s*\n/).filter((p) => !p.startsWith("#") && !p.startsWith("_") && contextOverlap(question, p) > 0).slice(0, 3).join("\n\n")
    if (relevant) add(`${name}.md`, name === "feedback" ? "Standing preferences" : name, relevant, "profile")
  }
  const memories = selectFeedPreferenceMemory((await readRecommendationFeedback(storage)).entries, readRecommendationPreferences(model.profile), new Date(), question)
  for (const m of memories.filter((m) => contextOverlap(question, `${m.title} ${m.topics.join(" ")}`) > 0).slice(0, 3)) {
    add(`feedback:${m.paperKey}`, "Remembered preference", JSON.stringify({ title: m.title, reason: m.reason, note: m.note,
      boundary: "Preference for framing only. Not an evidence exclusion; retain conflicting and foundational studies." }), "preference")
  }
  const bundle = await loadBundle(storage)
  const project = projectId ? await getProject(storage, projectId) : null // Missing project must throw.
  if (project) add(`project:${project.id}`, project.title, `${project.instructions}\n${project.overview}`, "project")
  const allowed = project ? new Set(project.members.map((m) => m.id)) : null
  const notes = [...bundle.pages.values()].filter((p) => (!allowed || allowed.has(p.id))
    && ["note", "paper", "concept", "method"].includes(p.frontmatter.type))
    .map((p) => ({ p, score: contextOverlap(question, `${p.frontmatter.title} ${p.body.slice(0, 3000)}`) }))
    .filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 4)
  for (const { p } of notes) add(p.id, p.frontmatter.title, p.body, "note")
  return result
}

/** Only this conversation, selected before the review's own brief is appended. */
export async function reviewConversationContext(storage: VaultStorage, sessionId: string, question: string): Promise<ReviewBrief["context"]> {
  const session = await loadSession(storage, sessionId)
  return (session?.messages ?? []).filter((m) => !m.error && !m.blocks?.length && contextOverlap(question, m.content) > 0).slice(-6).map((m) => {
    const text = `${m.role}: ${m.content.slice(0, 2200)}`
    const hash = hashReviewData(text)
    return { id: `conversation:${hash}`, label: "This conversation", kind: "conversation", text, hash }
  })
}

/** Select bibliographic seeds, not wiki-generated conclusions. Public identifiers
 * can be resolved by enabled paper indexes; notes never become search queries. */
export async function reviewLibrarySeeds(storage: VaultStorage, question: string, projectId?: string) {
  const project = projectId ? await getProject(storage, projectId) : null
  const allowed = project ? new Set(project.members.map((m) => m.id)) : null
  const bundle = await loadBundle(storage)
  return [...bundle.pages.values()].filter((p) => p.frontmatter.type === "paper" && (!allowed || allowed.has(p.id)))
    .map((p) => ({ paper: paperRecordFromFrontmatter(p.frontmatter), score: contextOverlap(question, `${p.frontmatter.title} ${p.body.slice(0, 2500)}`) }))
    .filter((p) => p.score > 0 && (p.paper.ids.doi || p.paper.ids.arxiv)).sort((a, b) => b.score - a.score).slice(0, 2).map((p) => p.paper)
}
