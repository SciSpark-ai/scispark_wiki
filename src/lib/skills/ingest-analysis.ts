import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { PaperRecord } from "../papers/types"
import type { DigestLike } from "../wiki/authoring"
import { DEFAULT_ROUTING } from "../wiki/schema-routing"
import { loadBundle } from "../vault/bundle"
import type { SkillContext } from "./types"

/** Cap on how much of the paper's full text goes into the analysis context (characters, not tokens). */
const MAX_FULL_TEXT_EXCERPT_CHARS = 30_000

export const AnalysisSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["author", "organization", "tool", "dataset", "other"]),
      inWiki: z.boolean(),
    }),
  ),
  concepts: z.array(
    z.object({
      name: z.string(),
      definition: z.string(),
      inWiki: z.boolean(),
    }),
  ),
  findings: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  connections: z.array(
    z.object({
      pageId: z.string(),
      relation: z.string(),
    }),
  ),
  contradictions: z.array(
    z.object({
      pageId: z.string(),
      description: z.string(),
    }),
  ),
  recommendations: z.object({
    pagesToCreate: z.array(
      z.object({
        type: z.string(),
        title: z.string(),
        rationale: z.string(),
      }),
    ),
    pagesToUpdate: z.array(
      z.object({
        pageId: z.string(),
        rationale: z.string(),
      }),
    ),
    emphasis: z.array(z.string()),
  }),
})

export type AnalysisResult = z.infer<typeof AnalysisSchema>

export interface BuildAnalysisContextOpts {
  paper: PaperRecord
  digest?: DigestLike
  fullTextExcerpt?: string
  highlights?: string[]
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/

/**
 * Extracts the raw "## Page Types" section (heading through the next
 * heading of equal-or-shallower level, or end of document) verbatim from a
 * schema.md's markdown source. Returns null when no such section exists or
 * it's empty — callers fall back to a rendered DEFAULT_ROUTING table.
 */
function extractPageTypesSlice(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/)

  let sectionLevel = -1
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING_RE.exec(lines[i])
    if (heading && heading[2].trim().toLowerCase() === "page types") {
      sectionLevel = heading[1].length
      startIdx = i
      break
    }
  }
  if (startIdx === -1) return null

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const heading = HEADING_RE.exec(lines[i])
    if (heading && heading[1].length <= sectionLevel) {
      endIdx = i
      break
    }
  }

  const slice = lines.slice(startIdx, endIdx).join("\n").trim()
  return slice === "" ? null : slice
}

/** Renders DEFAULT_ROUTING as the same `| type | directory |` table scaffold.ts writes. */
function renderDefaultRoutingTable(): string {
  const rows = Object.entries(DEFAULT_ROUTING)
    .map(([type, dir]) => `| ${type} | ${dir} |`)
    .join("\n")
  return `## Page Types\n\n| type | directory |\n|---|---|\n${rows}`
}

async function pageTypesSection(storage: VaultStorage): Promise<string> {
  const schema = await storage.read("schema.md")
  const slice = schema !== null ? extractPageTypesSlice(schema) : null
  return slice ?? renderDefaultRoutingTable()
}

/**
 * Builds the "Existing Wiki Index" section: index.md's raw content when it
 * actually lists pages, otherwise a bullet list of `<pageId> — <title>`
 * built directly from the vault bundle (covers a freshly-scaffolded vault
 * whose index.md is still just the bare "# Index" header, or a missing
 * index.md).
 */
async function indexSection(storage: VaultStorage): Promise<string> {
  const index = await storage.read("index.md")
  const trimmed = index?.trim() ?? ""
  const hasEntries = /^-\s/m.test(trimmed)
  if (hasEntries) return trimmed

  const bundle = await loadBundle(storage)
  if (bundle.pages.size === 0) return "(the wiki has no pages yet)"

  return [...bundle.pages.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((page) => `- ${page.id} — ${page.frontmatter.title}`)
    .join("\n")
}

function paperSection(paper: PaperRecord): string {
  const lines = [`Title: ${paper.title}`]
  const authorNames = paper.authors.map((a) => a.name).join(", ")
  lines.push(`Authors: ${authorNames || "Unknown"}`)
  if (paper.year !== undefined) lines.push(`Year: ${paper.year}`)
  if (paper.venue !== undefined) lines.push(`Venue: ${paper.venue}`)

  const ids: string[] = []
  if (paper.ids.doi) ids.push(`doi:${paper.ids.doi}`)
  if (paper.ids.arxiv) ids.push(`arxiv:${paper.ids.arxiv}`)
  if (paper.ids.openalex) ids.push(`openalex:${paper.ids.openalex}`)
  if (paper.ids.pmid) ids.push(`pmid:${paper.ids.pmid}`)
  if (ids.length > 0) lines.push(`Ids: ${ids.join(", ")}`)

  if (paper.abstract && paper.abstract.trim() !== "") {
    lines.push("", "Abstract:", paper.abstract.trim())
  }

  return lines.join("\n")
}

function digestSection(digest: DigestLike): string | null {
  const parts: string[] = []
  if (digest.summary && digest.summary.trim() !== "") parts.push(`Summary: ${digest.summary.trim()}`)
  if (digest.laySummary && digest.laySummary.trim() !== "") parts.push(`Lay summary: ${digest.laySummary.trim()}`)
  if (digest.keyPoints && digest.keyPoints.length > 0) {
    parts.push(`Key points:\n${digest.keyPoints.map((p) => `- ${p}`).join("\n")}`)
  }
  if (digest.methods && digest.methods.trim() !== "") parts.push(`Methods: ${digest.methods.trim()}`)
  if (digest.limitations && digest.limitations.trim() !== "") parts.push(`Limitations: ${digest.limitations.trim()}`)
  return parts.length > 0 ? parts.join("\n\n") : null
}

function truncateExcerpt(text: string): string {
  if (text.length <= MAX_FULL_TEXT_EXCERPT_CHARS) return text
  const truncated = text.slice(0, MAX_FULL_TEXT_EXCERPT_CHARS)
  const note = `\n\n[truncated to the first ${MAX_FULL_TEXT_EXCERPT_CHARS.toLocaleString("en-US")} characters of a longer document]`
  return truncated + note
}

/**
 * Assembles the labeled context the analysis step reads: Purpose, Page
 * Types, Existing Wiki Index, Paper, Digest (when present), Full Text
 * Excerpt (when present, truncated to MAX_FULL_TEXT_EXCERPT_CHARS with a
 * truncation notice only when text was actually cut), and User Highlights
 * (only when non-empty). Sections with nothing to say are skipped entirely
 * rather than emitted empty.
 */
export async function buildAnalysisContext(storage: VaultStorage, opts: BuildAnalysisContextOpts): Promise<string> {
  const sections: string[] = []

  const purpose = await storage.read("purpose.md")
  if (purpose !== null && purpose.trim() !== "") {
    sections.push(`## Purpose\n\n${purpose.trim()}`)
  }

  sections.push(await pageTypesSection(storage))

  sections.push(`## Existing Wiki Index\n\n${await indexSection(storage)}`)

  sections.push(`## Paper\n\n${paperSection(opts.paper)}`)

  if (opts.digest) {
    const rendered = digestSection(opts.digest)
    if (rendered) sections.push(`## Digest\n\n${rendered}`)
  }

  if (opts.fullTextExcerpt && opts.fullTextExcerpt.trim() !== "") {
    sections.push(`## Full Text Excerpt\n\n${truncateExcerpt(opts.fullTextExcerpt)}`)
  }

  if (opts.highlights && opts.highlights.length > 0) {
    const bullets = opts.highlights.map((h) => `- ${h}`).join("\n")
    sections.push(
      `## User Highlights\n\nThe user highlighted these passages — treat as emphasis signals:\n\n${bullets}`,
    )
  }

  return sections.join("\n\n")
}

/**
 * System instructions for the analysis step: a research-analyst framing
 * adapted from llm_wiki's `buildAnalysisPrompt` section discipline (Key
 * Entities / Key Concepts / Main Arguments & Findings / Connections to
 * Existing Wiki / Contradictions & Tensions / Recommendations), mapped onto
 * our structured AnalysisResult fields instead of markdown section output.
 */
function buildAnalysisSystemPrompt(): string {
  return [
    "You are an expert research analyst. Read the paper below (with its digest and full-text excerpt, when provided) against the existing wiki context and produce a structured analysis. Fill every field of the schema; use empty arrays where a section genuinely has nothing to report.",
    "",
    "entities: people, organizations, tools, or datasets mentioned in the paper (kind: author, organization, tool, dataset, or other). Role in the paper (central vs. peripheral) informs which entities are worth listing at all — skip incidental mentions.",
    "",
    "concepts: theories, methods, techniques, or phenomena central to the paper, each with a brief definition of why it matters here.",
    "",
    "For both entities and concepts: inWiki is true only when the Existing Wiki Index section below lists a matching page for that exact entity or concept — never guess or assume based on general knowledge. Default to false when the index doesn't clearly show it.",
    "",
    "findings: the paper's core claims or results, the evidence supporting each, and how strong that evidence is (strong/moderate/weak). Subject-boundary rule: identify the actual named subject of each claim. Do not transfer claims, limits, or evaluations from one entity, model, product, or method to another just because they share keywords or a similar name — a finding about model A is never evidence about model B.",
    "",
    "connections: existing wiki pages this paper relates to, and how it relates (strengthens, challenges, extends, etc.). pageId must be an id copied verbatim from the Existing Wiki Index section below — never invent or guess an id, and never point at the paper's own page.",
    "",
    "contradictions: places where this paper conflicts with existing wiki content, or internal tensions/caveats worth flagging. pageId must likewise be an id copied verbatim from the Existing Wiki Index section (omit contradictions with nothing in the index to point at).",
    "",
    "recommendations.pagesToCreate: new wiki pages this paper's actual content justifies — each with a type (must be one of the types listed in the Page Types section below), a title, and a rationale. Only recommend a page when the source genuinely supports it; never invent pages the paper doesn't contain material for.",
    "recommendations.pagesToUpdate: existing pages (pageId from the Existing Wiki Index) that this paper's content should cause to be revised, with a rationale.",
    "recommendations.emphasis: short phrases naming what should be emphasized (or de-emphasized) when the paper's content is written into the wiki.",
    "",
    "Treat the Existing Wiki Index section as the single source of truth for what already exists in the wiki — every inWiki flag and every pageId must be consistent with it.",
  ].join("\n")
}

/**
 * The analysis step: one `strong`-tier structured LLM call that reads the
 * assembled context (from `buildAnalysisContext`) and returns an
 * AnalysisResult. This is a plain step function — not a `defineSkill` unit
 * — because Task 7's `ingestSkill` calls it as the first of two LLM calls
 * (analysis, then generation) inside a single skill run, sharing one
 * `SkillContext` (and therefore one budget check / metering trail) across
 * both.
 */
export async function runAnalysis(ctx: SkillContext, context: string): Promise<AnalysisResult> {
  return ctx.llmStructured(
    "strong",
    {
      messages: [
        { role: "system", content: buildAnalysisSystemPrompt() },
        { role: "user", content: context },
      ],
    },
    AnalysisSchema,
  )
}
