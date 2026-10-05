import type { VaultStorage } from "../vault/storage"
import { loadBundle } from "../vault/bundle"
import { extractAbstractFromBody, resolvePaperBySlug } from "../papers/resolve"
import { findPaperPage } from "../papers/page-state"
import { loadCachedDigestBySlug } from "../skills/digest"
import { ChatPaperContextSchema, ChatPaperSlugSchema, type ChatPaperContext } from "./blocks"

const LIMIT = 16_000
function excerpt(text: string): string {
  const notice = "\n[Excerpt shortened; later text is not supplied.]"
  return text.length > LIMIT ? text.slice(0, LIMIT - notice.length) + notice : text
}

/** Read existing local evidence only: opening paper chat never acquires or generates content. */
export async function capturePaperContext(storage: VaultStorage, slug: string, now: Date): Promise<ChatPaperContext> {
  ChatPaperSlugSchema.parse(slug)
  const paper = await resolvePaperBySlug(storage, slug)
  if (!paper) throw new Error("This paper is unavailable. Reopen its paper page before asking Sparky.")
  const page = !paper.abstract ? findPaperPage(await loadBundle(storage), slug) : null
  const abstract = paper.abstract || (page ? extractAbstractFromBody(page.body) : undefined)
  const digest = await loadCachedDigestBySlug(storage, slug)
  const digestText = digest ? [
    `Overview: ${digest.summary}`, `Key points:\n${digest.keyPoints.join("\n")}`,
    `In plain language: ${digest.laySummary}`, `Methods: ${digest.methods}`,
    `Limitations: ${digest.limitations}`, `Field context: ${digest.fieldContext}`,
  ].join("\n\n") : undefined
  return ChatPaperContextSchema.parse({
    slug, capturedAt: now.toISOString(),
    paper: { ...paper, ...(abstract ? { abstract: excerpt(abstract) } : {}) },
    ...(digestText ? { digestText: excerpt(digestText) } : {}),
  })
}

export function renderPaperContext(context: ChatPaperContext, readSourcesOnly: boolean): string {
  const { paper } = context
  return [
    `[current-paper] ${paper.title.slice(0, 1000)}`,
    `Authors: ${paper.authors.map(a => a.name).join(", ").slice(0, 2000)}`,
    `Year: ${paper.year ?? "Unknown"}; venue: ${(paper.venue ?? "Unknown").slice(0, 500)}`,
    `Paper context saved at: ${context.capturedAt}`,
    ...(context.source?.access === "full-text" ? [
      `Full text${context.source.truncated ? " excerpt (shortened; do not claim complete coverage)" : " (extracted source text)"}:\n${context.source.text}`,
      `Source: ${context.source.locator}\n${context.source.notes.join("\n")}`,
      "Use this source text over earlier abstract-only answers or digests. Missing information in an earlier summary does not mean it is absent from this full text.",
    ] : ["Full text is not supplied. The runtime could not retrieve or verify it; do not claim the paper itself is inaccessible.", ...(context.source?.notes ?? [])]),
    `Original abstract (source text):\n${paper.abstract || "No abstract is available."}`,
    ...(!readSourcesOnly && context.source?.access !== "full-text" && context.digestText ? [
      `AI-generated digest (secondary summary, not independent source evidence; verify claims against the abstract):\n${context.digestText}`,
    ] : []),
  ].join("\n\n")
}
