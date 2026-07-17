import type { Bundle } from "../vault/bundle"
import { resolveLink } from "../vault/bundle"
import { parseDocument, serializeDocument } from "../vault/frontmatter"
import { buildIndexMarkdown } from "../vault/index-builder"
import { PAGE_TYPES, RESERVED_FILES } from "../vault/types"
import type { Frontmatter, FileChange, WikiPage } from "../vault/types"
import { extractWikilinks, findWikilinkMatches } from "../vault/wikilinks"
import type { LintFinding } from "./types"

const REQUIRED_FRONTMATTER_KEYS = [
  "type",
  "title",
  "created",
  "updated",
  "tags",
  "related",
  "sources",
] as const
const ARRAY_FRONTMATTER_KEYS = ["tags", "related", "sources"] as const

function basename(path: string): string {
  return path.split("/").pop() ?? path
}

/**
 * A page with zero inbound links, that isn't a reserved file (index.md/log.md/
 * purpose.md/schema.md — those are never in `bundle.pages` since `loadBundle`
 * only lists `wiki/`, but the guard is kept for defensiveness against future
 * bundle-construction paths) and isn't a `paper`/`author` type (those are
 * legitimately leaf-linked — inbound-only, nothing points back at them).
 * Advisory only: there's no safe mechanical fix for "nothing links here".
 */
export function findOrphans(bundle: Bundle): LintFinding[] {
  const findings: LintFinding[] = []
  const reserved: readonly string[] = RESERVED_FILES

  for (const page of bundle.pages.values()) {
    if (reserved.includes(basename(page.path))) continue
    if (page.frontmatter.type === "paper" || page.frontmatter.type === "author") continue

    const hasInbound = bundle.links.some((l) => l.to === page.id)
    if (hasInbound) continue

    findings.push({
      lintKind: "orphan",
      title: `"${page.frontmatter.title}" has no inbound links`,
      description:
        `Page "${page.id}" (type: ${page.frontmatter.type}) is not linked from any other page ` +
        `in the vault. Consider linking it from a related page, or removing it if it's no longer relevant.`,
      pages: [page.id],
    })
  }
  return findings
}

/**
 * Removes every REAL `[[slug]]` / `[[slug|alias]]` wikilink referencing
 * `slug` from `body` — i.e. exactly the occurrences `findWikilinkMatches`
 * (the same detector `extractWikilinks` uses) would report, never text
 * inside a fenced or inline code span — replacing each with its alias text
 * (or the bare slug if there's no alias) so the surrounding prose still
 * reads naturally. Rewriting is span-based (using the offsets
 * `findWikilinkMatches` found), not a naive string/regex replace, so it
 * can't touch a same-looking `[[slug]]` sitting inside a code span.
 */
function neutralizeWikilink(body: string, slug: string): string {
  const matches = findWikilinkMatches(body).filter((m) => m.slug === slug)
  let out = body
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    out = out.slice(0, m.start) + (m.alias ?? m.slug) + out.slice(m.end)
  }
  return out
}

/**
 * A wikilink whose slug resolves to no page in the vault. `bundle.errors`
 * only records "parse" and "ambiguity" kinds (see loadBundle) — an unresolved
 * link leaves no trace there, so this re-scans bodies with `extractWikilinks`
 * and re-resolves each slug the same way `loadBundle` does (`resolveLink`).
 * Mechanical fix: neutralize the broken link to plain text in the body.
 */
export function findBrokenLinks(bundle: Bundle): LintFinding[] {
  const findings: LintFinding[] = []

  for (const page of bundle.pages.values()) {
    for (const slug of extractWikilinks(page.body)) {
      if (resolveLink(bundle, slug)) continue

      findings.push({
        lintKind: "broken-link",
        title: `Broken wikilink [[${slug}]] in "${page.frontmatter.title}"`,
        description: `"${page.id}" links to [[${slug}]], which does not resolve to any page in the vault.`,
        pages: [page.id],
        // A page can have several broken links; the slug is the stable
        // discriminator applyLintFix uses to re-find THIS one after a sibling
        // broken-link fix on the same page has already been applied.
        fixTarget: slug,
        fix: {
          path: page.path,
          before: serializeDocument(page.frontmatter, page.body),
          after: serializeDocument(page.frontmatter, neutralizeWikilink(page.body, slug)),
        },
      })
    }
  }
  return findings
}

/**
 * True iff `raw` (a full file's raw text, frontmatter + body) round-trips
 * through the real frontmatter parser (`frontmatter.ts#parseDocument`) —
 * i.e. it's not just "has the required keys" per this file's local checks,
 * but actually satisfies every rule `parseDocument` enforces at load time
 * (required keys present, array keys are arrays, type/title non-empty
 * strings, created/updated valid date values). A mechanical `fix.after` must
 * pass this before it's ever emitted — a fix a later task auto-applies that
 * fails this would corrupt the page on its next load.
 */
function isValidFrontmatterDocument(raw: string): boolean {
  try {
    parseDocument(raw)
    return true
  } catch {
    return false
  }
}

/**
 * Re-validates each page's frontmatter against the same contract
 * `frontmatter.ts#parseDocument` enforces at parse time. Pages that reach
 * `bundle.pages` via `loadBundle` already satisfy this contract (a violation
 * there is a parse error, so the page never makes it into the bundle) — this
 * check exists for defensiveness against bundles assembled by other means
 * (e.g. hand-built fixtures, future direct writes) and for the one thing
 * `parseDocument` does NOT validate: that `type` is a recognized page type.
 *
 * - Missing "updated" with "created" present, AND "updated" is the ONLY
 *   missing required key -> mechanical fix (safe default: mirror "created").
 *   A mechanical fix is only ever emitted when the resulting document
 *   actually round-trips through the real frontmatter parser
 *   (`parseDocument`) — if some other required key is also missing, adding
 *   "updated" alone would still leave an invalid document, so this case
 *   falls through to the general "missing required key(s)" advisory below
 *   instead of emitting a fix that would corrupt the page on next load.
 * - Any other missing required key (or "updated" missing alongside another
 *   missing key) -> advisory listing every missing field, no fix (no safe
 *   default to guess the others).
 * - A required array field present but not an array -> advisory (structurally
 *   wrong; can't guess intended contents).
 * - An unrecognized `type` -> advisory.
 */
export function findBadFrontmatter(bundle: Bundle): LintFinding[] {
  const findings: LintFinding[] = []
  const knownTypes: readonly string[] = PAGE_TYPES

  for (const page of bundle.pages.values()) {
    const fm = page.frontmatter as Record<string, unknown>
    const missingKeys = REQUIRED_FRONTMATTER_KEYS.filter((key) => !(key in fm))

    if (missingKeys.length === 1 && missingKeys[0] === "updated" && typeof fm.created === "string") {
      const fixedFrontmatter = { ...page.frontmatter, updated: fm.created } as Frontmatter
      const after = serializeDocument(fixedFrontmatter, page.body)
      if (isValidFrontmatterDocument(after)) {
        findings.push({
          lintKind: "bad-frontmatter",
          title: `"${page.id}" is missing "updated"`,
          description:
            `Frontmatter for "${page.id}" has no "updated" field; defaulting it to its ` +
            `"created" date (${fm.created}).`,
          pages: [page.id],
          fix: {
            path: page.path,
            before: serializeDocument(page.frontmatter, page.body),
            after,
          },
        })
        continue
      }
      // Round-trip failed for some other reason (e.g. "created" isn't a
      // valid date string) -> fall through to the advisory path below,
      // which still correctly reports "updated" as the only missing key.
    }

    if (missingKeys.length > 0) {
      findings.push({
        lintKind: "bad-frontmatter",
        title: `"${page.id}" is missing required frontmatter field(s): ${missingKeys.join(", ")}`,
        description: `Frontmatter for "${page.id}" is missing: ${missingKeys.join(", ")}. No safe default to fill these in automatically.`,
        pages: [page.id],
      })
      continue
    }

    const badArrayKeys = ARRAY_FRONTMATTER_KEYS.filter((key) => !Array.isArray(fm[key]))
    if (badArrayKeys.length > 0) {
      findings.push({
        lintKind: "bad-frontmatter",
        title: `"${page.id}" has non-array field(s): ${badArrayKeys.join(", ")}`,
        description: `Frontmatter field(s) ${badArrayKeys.join(", ")} on "${page.id}" must be arrays.`,
        pages: [page.id],
      })
      continue
    }

    if (typeof fm.type !== "string" || !knownTypes.includes(fm.type)) {
      findings.push({
        lintKind: "bad-frontmatter",
        title: `"${page.id}" has an unrecognized type "${String(fm.type)}"`,
        description: `"${page.id}"'s frontmatter type "${String(fm.type)}" is not one of the vault's page types (${knownTypes.join(", ")}).`,
        pages: [page.id],
      })
    }
  }
  return findings
}

/**
 * Recomputes index.md from the current pages (`buildIndexMarkdown`, same
 * function `writeIndex` uses) and diffs it against the caller-supplied
 * current content of index.md. `Bundle` itself carries no reserved-file
 * content (`loadBundle` only lists `wiki/`), so the stored index text must be
 * passed in explicitly by the caller (the orchestrator, which holds the
 * `VaultStorage` and can `storage.read("index.md")`).
 *
 * `storedIndex === undefined` means "not supplied" -> the check is skipped
 * (no finding either way, since drift can't be determined). `null` means
 * "supplied, and index.md does not exist" -> real drift if the vault has
 * any pages at all.
 */
export function findIndexDrift(bundle: Bundle, storedIndex: string | null | undefined): LintFinding[] {
  if (storedIndex === undefined) return []

  const recomputed = buildIndexMarkdown(bundle)
  if (storedIndex === recomputed) return []

  return [
    {
      lintKind: "index-drift",
      title: "index.md is out of date",
      description: "index.md does not match what would be recomputed from the current wiki pages.",
      pages: [],
      fix: { path: "index.md", before: storedIndex, after: recomputed },
    },
  ]
}

const ID_KEYED_AUTHOR_SLUG = /^a\d+$/

/** Final path segment of a bundle page id — its wikilink slug (bundle ids
 * never carry the ".md" extension, unlike `WikiPage.path`). */
function slugOf(id: string): string {
  return id.split("/").pop() ?? id
}

/** Normalizes an author's display title for duplicate grouping, per the C6
 * spec: case-fold and collapse periods/whitespace so "Edmund C. Lalor" and
 * "edmund c lalor" group together regardless of punctuation/casing drift
 * between the deterministic id-keyed skeleton and an LLM-authored name-slug
 * page. */
function normalizeAuthorTitle(title: string): string {
  return title.toLowerCase().replace(/[.\s]+/g, " ").trim()
}

function dedupeStable(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/**
 * Same span-based rewrite as `neutralizeWikilink` above, but RENAMES the slug
 * (keeping the link, and any alias, intact) instead of flattening it to plain
 * text — used by the duplicate-author merge fix to repoint every `[[extra]]`
 * reference at the canonical id-keyed slug.
 */
function renameWikilink(body: string, fromSlug: string, toSlug: string): string {
  const matches = findWikilinkMatches(body).filter((m) => m.slug === fromSlug)
  let out = body
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    const replacement = m.alias !== undefined ? `[[${toSlug}|${m.alias}]]` : `[[${toSlug}]]`
    out = out.slice(0, m.start) + replacement + out.slice(m.end)
  }
  return out
}

// ---------------------------------------------------------------------------
// Author-page body/frontmatter shape helpers, for classifying which of the two
// duplicate pages (if either) is a bare skeleton safe to overwrite. An author
// page written by `buildAuthorSkeletons` (src/lib/wiki/authoring.ts) has the
// shape `# <name>\n\n## Papers\n\n- [[paper]]\n` with empty tags/related/sources
// — nothing an LLM-authored biography page adds. The C6 merge must never
// silently delete the RICHER of the two pages (the review found the real Lalor
// case deleted the biography), so it first works out which page is the skeleton.
// ---------------------------------------------------------------------------

interface BodySection {
  heading: string
  content: string
}

/** Splits an author page body into the intro (everything before the first `##`
 * heading — the `# <name>` H1 plus any lead prose) and its `##` sections. */
function splitAuthorBody(body: string): { intro: string; sections: BodySection[] } {
  const introLines: string[] = []
  const sections: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } | null = null
  for (const line of body.split("\n")) {
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2) {
      current = { heading: h2[1].trim(), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      introLines.push(line)
    }
  }
  return {
    intro: introLines.join("\n"),
    sections: sections.map((s) => ({ heading: s.heading, content: s.lines.join("\n") })),
  }
}

/** True iff the intro is just the `# <name>` H1 (plus blank lines) — no lead
 * biography prose. */
function introIsHeadingOnly(intro: string): boolean {
  const nonEmpty = intro.split("\n").map((l) => l.trim()).filter(Boolean)
  return nonEmpty.length === 0 || (nonEmpty.length === 1 && /^#\s+/.test(nonEmpty[0]))
}

/** The `- ...` bullet lines (trimmed) of a section's content. */
function bulletItems(content: string): string[] {
  return content.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-"))
}

/** True iff every non-empty line of `content` is a `- ` bullet (a Papers list). */
function contentIsBulletList(content: string): boolean {
  return content.split("\n").map((l) => l.trim()).filter(Boolean).every((l) => l.startsWith("-"))
}

function findPapersSection(sections: BodySection[]): BodySection | undefined {
  return sections.find((s) => s.heading.toLowerCase() === "papers")
}

/** True iff `body` is a `buildAuthorSkeletons`-shaped skeleton: an H1-only
 * intro and, at most, a single `## Papers` section whose content is a bullet
 * list — i.e. it carries no biography prose or other sections. */
function isSkeletonAuthorBody(body: string): boolean {
  const { intro, sections } = splitAuthorBody(body)
  if (!introIsHeadingOnly(intro)) return false
  if (sections.length === 0) return true
  if (sections.length !== 1) return false
  const only = sections[0]
  return only.heading.toLowerCase() === "papers" && contentIsBulletList(only.content)
}

function isSubset(candidate: string[], of: string[]): boolean {
  const set = new Set(of)
  return candidate.every((x) => set.has(x))
}

/** The extra page's `related[]` renamed extra→canonical and stripped of any
 * self-reference to the canonical slug — the form it would take once merged. */
function renamedRelated(related: string[], extraSlug: string, canonicalSlug: string): string[] {
  return related.map((s) => (s === extraSlug ? canonicalSlug : s)).filter((s) => s !== canonicalSlug)
}

/** The later of two `YYYY-MM-DD` date strings (lexicographic compare is
 * correct for that format); used to bump the merged canonical's `updated`. */
function laterDate(a: string, b: string): string {
  return a >= b ? a : b
}

/** Rebuilds a body from its intro + sections with normalized `\n\n` spacing.
 * Used only when the merge actually restructures the body (branch 2). */
function rebuildBody(intro: string, sections: BodySection[]): string {
  const parts: string[] = []
  const introTrim = intro.trim()
  if (introTrim) parts.push(introTrim)
  for (const s of sections) {
    parts.push(`## ${s.heading}\n\n${s.content.trim()}`.trimEnd())
  }
  return parts.join("\n\n") + "\n"
}

type DuplicateResolution =
  | { kind: "trivial" } // extra adds nothing — delete it, rewrite referrers
  | { kind: "merge-into-canonical" } // extra is richer, canonical is a skeleton — absorb then delete
  | { kind: "manual" } // both substantive — advisory only, no auto-fix

/**
 * Decides how to resolve one duplicate pair without ever losing content:
 * - "trivial": the extra page is a skeleton whose Papers list and
 *   tags/related/sources are all already covered by the canonical — deleting
 *   it loses nothing.
 * - "merge-into-canonical": the extra carries content (biography prose, richer
 *   frontmatter, or a unique paper) and the CANONICAL is a bare skeleton — the
 *   fix absorbs the extra into the canonical before deleting the extra.
 * - "manual": both pages carry substantive, potentially divergent content —
 *   no automatic fix; the finding is advisory so a human merges by hand.
 */
function classifyDuplicate(canonical: WikiPage, extra: WikiPage, extraSlug: string, canonicalSlug: string): DuplicateResolution {
  const extraSkeleton = isSkeletonAuthorBody(extra.body)
  const canonicalSkeleton = isSkeletonAuthorBody(canonical.body)

  if (extraSkeleton) {
    const extraPapers = bulletItems(findPapersSection(splitAuthorBody(extra.body).sections)?.content ?? "")
    const canonicalPapers = bulletItems(findPapersSection(splitAuthorBody(canonical.body).sections)?.content ?? "")
    const extraRelated = renamedRelated(extra.frontmatter.related, extraSlug, canonicalSlug)
    const trivial =
      isSubset(extra.frontmatter.tags, canonical.frontmatter.tags) &&
      isSubset(extra.frontmatter.sources, canonical.frontmatter.sources) &&
      isSubset(extraRelated, canonical.frontmatter.related) &&
      isSubset(extraPapers, canonicalPapers)
    if (trivial) return { kind: "trivial" }
  }

  const canonicalFrontmatterEmpty =
    canonical.frontmatter.tags.length === 0 &&
    canonical.frontmatter.related.length === 0 &&
    canonical.frontmatter.sources.length === 0
  if (canonicalSkeleton && canonicalFrontmatterEmpty) return { kind: "merge-into-canonical" }

  return { kind: "manual" }
}

/**
 * Rewrites every page OTHER than the ones in `skip` whose body wikilinks or
 * `related[]` reference `extraSlug`, repointing them at `canonicalSlug` (same
 * rename-and-dedupe semantics as `dedupeAuthorFiles` in src/lib/skills/ingest.ts,
 * which prevents this duplication on NEW ingests but can't retroactively fix a
 * vault that already has both pages).
 */
function rewriteReferrers(
  bundle: Bundle,
  extraSlug: string,
  canonicalSlug: string,
  skip: ReadonlySet<string>,
): FileChange[] {
  const changes: FileChange[] = []
  for (const page of bundle.pages.values()) {
    if (skip.has(page.id)) continue

    const linksToExtra = findWikilinkMatches(page.body).some((m) => m.slug === extraSlug)
    const relatedHasExtra = page.frontmatter.related.includes(extraSlug)
    if (!linksToExtra && !relatedHasExtra) continue

    const newBody = linksToExtra ? renameWikilink(page.body, extraSlug, canonicalSlug) : page.body
    const newRelated = relatedHasExtra
      ? dedupeStable(page.frontmatter.related.map((slug) => (slug === extraSlug ? canonicalSlug : slug)))
      : page.frontmatter.related
    const newFrontmatter: Frontmatter = { ...page.frontmatter, related: newRelated }

    changes.push({
      path: page.path,
      before: serializeDocument(page.frontmatter, page.body),
      after: serializeDocument(newFrontmatter, newBody),
    })
  }
  return changes
}

/** A `delete this file` change (before = current serialized content). */
function deletePageChange(page: WikiPage): FileChange {
  return { path: page.path, before: serializeDocument(page.frontmatter, page.body), after: null }
}

/**
 * Branch 1 (extra trivial): keep the canonical as-is, rewrite every referrer
 * from the extra slug to the canonical slug, and delete the extra page.
 */
function buildTrivialFix(bundle: Bundle, extra: WikiPage, canonicalSlug: string): FileChange[] {
  const extraSlug = slugOf(extra.id)
  return [...rewriteReferrers(bundle, extraSlug, canonicalSlug, new Set([extra.id])), deletePageChange(extra)]
}

/**
 * Branch 2 (extra rich, canonical skeleton): fold the extra's content INTO the
 * canonical page — union tags/related/sources, keep the canonical's
 * title/created + OpenAlex id, bump `updated`, and use the extra's body (its
 * biography) with the canonical's `## Papers` entries merged in (deduped;
 * appended as a Papers section if the extra has none). Then rewrite referrers
 * and delete the extra — nothing from either page is lost.
 */
function buildMergeIntoCanonicalFix(bundle: Bundle, canonical: WikiPage, extra: WikiPage, canonicalSlug: string): FileChange[] {
  const extraSlug = slugOf(extra.id)

  // Body: the extra's biography, with extra→canonical self-references renamed,
  // and the canonical skeleton's Papers list folded in.
  const renamedExtraBody = renameWikilink(extra.body, extraSlug, canonicalSlug)
  const { intro, sections } = splitAuthorBody(renamedExtraBody)
  const canonicalPapers = bulletItems(findPapersSection(splitAuthorBody(canonical.body).sections)?.content ?? "")
  const existingPapers = findPapersSection(sections)
  if (existingPapers) {
    const merged = dedupeStable([...bulletItems(existingPapers.content), ...canonicalPapers])
    existingPapers.content = merged.join("\n")
  } else if (canonicalPapers.length > 0) {
    sections.push({ heading: "Papers", content: canonicalPapers.join("\n") })
  }
  const mergedBody = rebuildBody(intro, sections)

  // Frontmatter: keep canonical's base (type/title/created + openalex etc.),
  // union the three list fields, bump updated to the later of the two.
  const mergedRelated = dedupeStable([
    ...canonical.frontmatter.related,
    ...renamedRelated(extra.frontmatter.related, extraSlug, canonicalSlug),
  ]).filter((s) => s !== canonicalSlug)
  const mergedFrontmatter: Frontmatter = {
    ...canonical.frontmatter,
    tags: dedupeStable([...canonical.frontmatter.tags, ...extra.frontmatter.tags]),
    related: mergedRelated,
    sources: dedupeStable([...canonical.frontmatter.sources, ...extra.frontmatter.sources]),
    updated: laterDate(String(canonical.frontmatter.updated), String(extra.frontmatter.updated)),
  }

  const canonicalChange: FileChange = {
    path: canonical.path,
    before: serializeDocument(canonical.frontmatter, canonical.body),
    after: serializeDocument(mergedFrontmatter, mergedBody),
  }

  return [
    canonicalChange,
    ...rewriteReferrers(bundle, extraSlug, canonicalSlug, new Set([extra.id, canonical.id])),
    deletePageChange(extra),
  ]
}

/**
 * The ingest pipeline's `dedupeAuthorFiles` (src/lib/skills/ingest.ts:338)
 * stops a NEW ingest from creating a second author page under a name slug
 * when a deterministic OpenAlex-id-keyed page already exists for that
 * author — but a vault ingested BEFORE that fix landed can still carry both:
 * `wiki/authors/a5074790393.md` (id-keyed, code-owned) AND
 * `wiki/authors/edmund-c-lalor.md` (name-slug, LLM-authored) for the same
 * person. This groups `author` pages by normalized title (see
 * `normalizeAuthorTitle`) and, for every group containing EXACTLY one
 * id-keyed page (`/^a\d+$/`) plus at least one other page, flags each extra
 * page as a duplicate — one finding per extra page. Groups with zero or more
 * than one id-keyed page are left unflagged: with no single unambiguous
 * canonical page there's no safe merge target to guess (e.g. two distinct
 * real people who happen to share a display name).
 *
 * The fix is chosen per pair by `classifyDuplicate` so it NEVER silently
 * deletes the richer of the two pages: the trivial case deletes the skeleton
 * extra; the "canonical is a skeleton" case folds the extra's biography +
 * frontmatter into the canonical first; and the "both substantive" case is
 * advisory only (no auto-fix — the description tells the user to merge by hand).
 */
export function findDuplicateAuthors(bundle: Bundle): LintFinding[] {
  const groups = new Map<string, WikiPage[]>()
  for (const page of bundle.pages.values()) {
    if (page.frontmatter.type !== "author") continue
    const key = normalizeAuthorTitle(page.frontmatter.title)
    const bucket = groups.get(key)
    if (bucket) bucket.push(page)
    else groups.set(key, [page])
  }

  const findings: LintFinding[] = []
  for (const pages of groups.values()) {
    if (pages.length < 2) continue
    const idKeyed = pages.filter((p) => ID_KEYED_AUTHOR_SLUG.test(slugOf(p.id)))
    if (idKeyed.length !== 1) continue

    const canonical = idKeyed[0]
    const canonicalSlug = slugOf(canonical.id)
    const extras = pages.filter((p) => p.id !== canonical.id)

    for (const extra of extras) {
      const extraSlug = slugOf(extra.id)
      const resolution = classifyDuplicate(canonical, extra, extraSlug, canonicalSlug)
      const base = {
        lintKind: "duplicate-author" as const,
        title: `"${canonical.frontmatter.title}" has duplicate author pages`,
        pages: [canonical.id, extra.id],
        fixTarget: extra.id,
      }
      const bothRepresent =
        `"${extra.id}" and "${canonical.id}" both represent "${canonical.frontmatter.title}". `

      if (resolution.kind === "trivial") {
        findings.push({
          ...base,
          description:
            bothRepresent +
            `The duplicate adds no content beyond the canonical, so the fix rewrites every ` +
            `reference from "${extraSlug}" to "${canonicalSlug}" and removes the duplicate page.`,
          fixes: buildTrivialFix(bundle, extra, canonicalSlug),
        })
      } else if (resolution.kind === "merge-into-canonical") {
        findings.push({
          ...base,
          description:
            bothRepresent +
            `The canonical page is a bare skeleton, so the fix keeps the biography and details ` +
            `from the duplicate and folds them into "${canonicalSlug}" (unioning tags/related/` +
            `sources and merging its Papers list), rewrites every reference to it, and removes ` +
            `the duplicate page.`,
          fixes: buildMergeIntoCanonicalFix(bundle, canonical, extra, canonicalSlug),
        })
      } else {
        findings.push({
          ...base,
          description:
            bothRepresent +
            `Both pages have substantive, differing content, so no automatic fix is offered ` +
            `(it could lose content) — merge "${extraSlug}" into "${canonicalSlug}" by hand, then ` +
            `delete the duplicate.`,
        })
      }
    }
  }
  return findings
}

export function runDeterministicChecks(
  bundle: Bundle,
  opts: { storedIndex?: string | null } = {},
): LintFinding[] {
  return [
    ...findOrphans(bundle),
    ...findBrokenLinks(bundle),
    ...findBadFrontmatter(bundle),
    ...findDuplicateAuthors(bundle),
    ...findIndexDrift(bundle, opts.storedIndex),
  ]
}
