import type { Bundle } from "../vault/bundle"
import { resolveLink } from "../vault/bundle"
import { serializeDocument } from "../vault/frontmatter"
import { buildIndexMarkdown } from "../vault/index-builder"
import { PAGE_TYPES, RESERVED_FILES } from "../vault/types"
import type { Frontmatter } from "../vault/types"
import { extractWikilinks } from "../vault/wikilinks"
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Removes every `[[slug]]` / `[[slug|alias]]` wikilink referencing `slug` from
 * `body`, replacing each occurrence with its alias text (or the bare slug if
 * there's no alias) so the surrounding prose still reads naturally. */
function neutralizeWikilink(body: string, slug: string): string {
  const re = new RegExp(`\\[\\[\\s*${escapeRegExp(slug)}\\s*(?:\\|([^\\]]*))?\\s*\\]\\]`, "g")
  return body.replace(re, (_match: string, alias?: string) =>
    alias !== undefined && alias.trim() ? alias.trim() : slug,
  )
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
 * Re-validates each page's frontmatter against the same contract
 * `frontmatter.ts#parseDocument` enforces at parse time. Pages that reach
 * `bundle.pages` via `loadBundle` already satisfy this contract (a violation
 * there is a parse error, so the page never makes it into the bundle) — this
 * check exists for defensiveness against bundles assembled by other means
 * (e.g. hand-built fixtures, future direct writes) and for the one thing
 * `parseDocument` does NOT validate: that `type` is a recognized page type.
 *
 * - Missing "updated" with "created" present -> mechanical fix (safe default:
 *   mirror "created").
 * - Any other missing required key -> advisory (no safe default to guess).
 * - A required array field present but not an array -> advisory (structurally
 *   wrong; can't guess intended contents).
 * - An unrecognized `type` -> advisory.
 */
export function findBadFrontmatter(bundle: Bundle): LintFinding[] {
  const findings: LintFinding[] = []
  const knownTypes: readonly string[] = PAGE_TYPES

  for (const page of bundle.pages.values()) {
    const fm = page.frontmatter as Record<string, unknown>

    if (!("updated" in fm) && typeof fm.created === "string") {
      const fixedFrontmatter = { ...page.frontmatter, updated: fm.created } as Frontmatter
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
          after: serializeDocument(fixedFrontmatter, page.body),
        },
      })
      continue
    }

    const missingKeys = REQUIRED_FRONTMATTER_KEYS.filter((key) => !(key in fm))
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

export function runDeterministicChecks(
  bundle: Bundle,
  opts: { storedIndex?: string | null } = {},
): LintFinding[] {
  return [
    ...findOrphans(bundle),
    ...findBrokenLinks(bundle),
    ...findBadFrontmatter(bundle),
    ...findIndexDrift(bundle, opts.storedIndex),
  ]
}
