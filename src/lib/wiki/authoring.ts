import type { PaperRecord } from "../papers/types"
import { serializeDocument } from "../vault/frontmatter"
import type { Frontmatter } from "../vault/types"

const MAX_SLUG_LENGTH = 80

// Han (+ extension A + compatibility), Hiragana/Katakana, Hangul syllables.
// Mirrors schema-routing.ts's CJK_RE so slugs accepted here stay in sync
// with what validateFilesAgainstRouting treats as a valid CJK slug.
const CJK_CHARS = "぀-ヿ㐀-䶿一-鿿豈-﫿가-힣"
const NON_SLUG_RUN_RE = new RegExp(`[^a-z0-9${CJK_CHARS}]+`, "g")

/**
 * Slugifies a title into a kebab-case (or CJK-preserving) filename stem:
 * lowercase, any run of characters that isn't [a-z0-9] or CJK collapses to
 * a single "-", leading/trailing "-" is trimmed, and the result is capped
 * at 80 characters — cutting back to the nearest "-" boundary within that
 * window when one exists, so words aren't truncated mid-way. A title that
 * slugifies to nothing (empty, or punctuation-only) falls back to
 * "untitled" so callers never get an empty path segment.
 */
export function slugifyTitle(title: string): string {
  const slug = title.toLowerCase().replace(NON_SLUG_RUN_RE, "-").replace(/^-+|-+$/g, "")
  if (slug.length <= MAX_SLUG_LENGTH) return slug === "" ? "untitled" : slug

  let cut = slug.slice(0, MAX_SLUG_LENGTH)
  const lastDash = cut.lastIndexOf("-")
  if (lastDash > 0) cut = cut.slice(0, lastDash)
  cut = cut.replace(/-+$/g, "")
  return cut === "" ? "untitled" : cut
}

/**
 * Slug for a paper's own page, precedence: arxiv id (dots and slashes ->
 * "-", so legacy ids like "math/0211159" become "math-0211159") > doi (run
 * through slugifyTitle, so "10.1038/nature123" becomes
 * "10-1038-nature123") > slugifyTitle(title).
 */
export function paperSlug(paper: PaperRecord): string {
  const { arxiv, doi } = paper.ids
  if (arxiv) return arxiv.toLowerCase().replace(/\./g, "-").replace(/\//g, "-")
  if (doi) return slugifyTitle(doi)
  return slugifyTitle(paper.title)
}

export interface PageDraft {
  path: string
  frontmatter: Frontmatter
  body: string
}

/**
 * Structural shape of Task 5's DigestResult, duplicated here (rather than
 * imported) so this module doesn't take a compile-time dependency on
 * src/lib/skills/digest.ts, which lands after this task. Any object with
 * this shape (including the real DigestResult) works as opts.digest.
 */
export interface DigestLike {
  summary?: string
  laySummary?: string
  keyPoints?: string[]
  methods?: string
  limitations?: string
}

export interface BuildPaperPageOpts {
  digest?: DigestLike
  fullText: boolean
  projects?: string[]
  today: string
  sources?: string[]
}

function buildDigestSection(digest: DigestLike): string {
  const lines: string[] = ["## Digest"]

  if (digest.summary && digest.summary.trim() !== "") {
    lines.push("", digest.summary.trim())
  }
  if (digest.keyPoints && digest.keyPoints.length > 0) {
    lines.push("", "**Key points**", "")
    for (const point of digest.keyPoints) lines.push(`- ${point}`)
  }
  if (digest.laySummary && digest.laySummary.trim() !== "") {
    lines.push("", "**Lay summary**", "", digest.laySummary.trim())
  }
  if (digest.methods && digest.methods.trim() !== "") {
    lines.push("", "**Methods**", "", digest.methods.trim())
  }
  if (digest.limitations && digest.limitations.trim() !== "") {
    lines.push("", "**Limitations**", "", digest.limitations.trim())
  }

  return lines.join("\n")
}

function buildLinksSection(paper: PaperRecord): string | null {
  const lines: string[] = []
  if (paper.ids.doi) lines.push(`- DOI: [${paper.ids.doi}](https://doi.org/${paper.ids.doi})`)
  if (paper.ids.arxiv) lines.push(`- arXiv: [${paper.ids.arxiv}](https://arxiv.org/abs/${paper.ids.arxiv})`)
  if (paper.oaUrl) lines.push(`- Open access: ${paper.oaUrl}`)
  if (paper.pdfUrl) lines.push(`- PDF: ${paper.pdfUrl}`)
  if (lines.length === 0) return null
  return ["## Links", "", ...lines].join("\n")
}

/**
 * Builds the deterministic paper page draft: code (never the LLM) owns
 * this page's frontmatter and structure, so ingest always has a stable
 * anchor to link from. `tags`/`related` start empty — the LLM adds
 * knowledge tags/relations later during ingest; this layer stays neutral.
 */
export function buildPaperPage(paper: PaperRecord, opts: BuildPaperPageOpts): PageDraft {
  const slug = paperSlug(paper)
  const path = `wiki/papers/${slug}.md`

  const frontmatter: Frontmatter = {
    type: "paper",
    title: paper.title,
    created: opts.today,
    updated: opts.today,
    tags: [],
    related: [],
    sources: opts.sources ?? [],
    authors: paper.authors.map((a) => a.name),
    projects: opts.projects ?? [],
    full_text: opts.fullText,
  }
  if (paper.ids.doi !== undefined) frontmatter.doi = paper.ids.doi
  if (paper.ids.arxiv !== undefined) frontmatter.arxiv = paper.ids.arxiv
  if (paper.ids.openalex !== undefined) frontmatter.openalex = paper.ids.openalex
  if (paper.ids.pmid !== undefined) frontmatter.pmid = paper.ids.pmid
  if (paper.year !== undefined) frontmatter.year = paper.year
  if (paper.venue !== undefined) frontmatter.venue = paper.venue

  const sections: string[] = [`# ${paper.title}`]
  if (opts.digest) sections.push(buildDigestSection(opts.digest))
  if (paper.abstract && paper.abstract.trim() !== "") {
    sections.push(`## Abstract\n\n${paper.abstract.trim()}`)
  }
  const linksSection = buildLinksSection(paper)
  if (linksSection) sections.push(linksSection)

  const body = sections.join("\n\n") + "\n"

  return { path, frontmatter, body }
}

export interface BuildAuthorSkeletonsOpts {
  existingIds: Set<string>
  today: string
  paperPageSlug: string
}

/**
 * Builds one skeleton page draft per author on the paper, skipping any
 * author whose page id (`wiki/authors/<slug>`, no extension — matching the
 * id shape a bundle's `pages` map uses) is already in `opts.existingIds`.
 * Slug is the author's `openalexId` (lowercased) when known, else
 * `slugifyTitle(name)`. Handles duplicate author names within the same call
 * by suffixing -2, -3, etc. on collision.
 */
export function buildAuthorSkeletons(paper: PaperRecord, opts: BuildAuthorSkeletonsOpts): PageDraft[] {
  const drafts: PageDraft[] = []
  const seenSlugs = new Set<string>()

  for (const author of paper.authors) {
    let baseSlug = author.openalexId ? author.openalexId.toLowerCase() : slugifyTitle(author.name)
    let id = `wiki/authors/${baseSlug}`

    // Skip if this exact id is already in existingIds (pre-existing page)
    if (opts.existingIds.has(id)) continue

    // Handle collisions within this batch by suffixing -2, -3, etc.
    let slug = baseSlug
    if (seenSlugs.has(baseSlug)) {
      let suffix = 2
      let candidateSlug = `${baseSlug}-${suffix}`
      while (seenSlugs.has(candidateSlug) || opts.existingIds.has(`wiki/authors/${candidateSlug}`)) {
        suffix++
        candidateSlug = `${baseSlug}-${suffix}`
      }
      slug = candidateSlug
      id = `wiki/authors/${candidateSlug}`
    }

    seenSlugs.add(slug)
    const frontmatter: Frontmatter = {
      type: "author",
      title: author.name,
      created: opts.today,
      updated: opts.today,
      tags: [],
      related: [],
      sources: [],
    }
    if (author.openalexId !== undefined) frontmatter.openalex = author.openalexId

    const body = `# ${author.name}\n\n## Papers\n\n- [[${opts.paperPageSlug}]]\n`

    drafts.push({ path: `${id}.md`, frontmatter, body })
  }

  return drafts
}

/** Serializes a page draft to the on-disk document text (M1 frontmatter module). */
export function composePage(draft: PageDraft): string {
  return serializeDocument(draft.frontmatter, draft.body)
}
