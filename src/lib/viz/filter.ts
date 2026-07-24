import type { Bundle } from "../vault/bundle"
import { PAGE_TYPES, type WikiPage } from "../vault/types"

export interface VizFilters {
  types: string[] // empty = all types
  tags: string[] // empty = all; match = page has ANY selected tag
  yearRange: { min: number | null; max: number | null } // applies only to pages with a derivable year
}

export const EMPTY_FILTERS: VizFilters = { types: [], tags: [], yearRange: { min: null, max: null } }

export function isEmptyFilters(f: VizFilters): boolean {
  return f.types.length === 0 && f.tags.length === 0 && f.yearRange.min === null && f.yearRange.max === null
}

/**
 * Shared year-derivation convention: `frontmatter.year` when it's a number,
 * else the leading 4 digits of `created` (parsed as an int), else null when
 * neither is derivable. This is the ONE place that convention lives —
 * `deriveTimeline` (src/lib/viz/timeline.ts) and the viz dashboard's
 * citation-flow year mapping (src/app/viz/page.tsx) both call this instead
 * of re-deriving it.
 */
export function pageYear(page: WikiPage): number | null {
  const y = page.frontmatter.year
  if (typeof y === "number") return y
  const parsed = parseInt((page.frontmatter.created ?? "").slice(0, 4), 10)
  return Number.isNaN(parsed) ? null : parsed
}

function matchesFilters(page: WikiPage, filters: VizFilters): boolean {
  if (filters.types.length > 0 && !filters.types.includes(page.frontmatter.type)) return false

  if (filters.tags.length > 0) {
    const tags = page.frontmatter.tags ?? []
    if (!filters.tags.some((t) => tags.includes(t))) return false
  }

  if (filters.yearRange.min !== null || filters.yearRange.max !== null) {
    const year = pageYear(page)
    // Undated pages (concepts, methods…) pass through unaffected — the range
    // only constrains pages that actually have a derivable year.
    if (year !== null) {
      if (filters.yearRange.min !== null && year < filters.yearRange.min) return false
      if (filters.yearRange.max !== null && year > filters.yearRange.max) return false
    }
  }

  return true
}

/**
 * Returns a NEW Bundle containing only the pages that pass all filter
 * predicates, links whose endpoints both survive, and errors passed through
 * unchanged. When `filters` is empty (per `isEmptyFilters`), returns the
 * INPUT bundle by reference so downstream `useMemo`s keyed on bundle
 * identity don't needlessly invalidate.
 */
export function filterBundle(bundle: Bundle, filters: VizFilters): Bundle {
  if (isEmptyFilters(filters)) return bundle

  const pages = new Map<string, WikiPage>()
  for (const [id, page] of bundle.pages) {
    if (matchesFilters(page, filters)) pages.set(id, page)
  }

  const links = bundle.links.filter((l) => pages.has(l.from) && pages.has(l.to))

  return { pages, links, errors: bundle.errors }
}

export interface VizFilterOptions {
  types: string[]
  tags: string[]
  yearBounds: { min: number; max: number } | null
}

/** Feeds the FilterBar: present types (in PAGE_TYPES order), distinct sorted
 * tags, and the min/max over pages with a derivable year (null if none). */
export function filterOptions(bundle: Bundle): VizFilterOptions {
  const presentTypes = new Set<string>()
  const presentTags = new Set<string>()
  let min: number | null = null
  let max: number | null = null

  for (const page of bundle.pages.values()) {
    presentTypes.add(page.frontmatter.type)
    for (const tag of page.frontmatter.tags ?? []) presentTags.add(tag)

    const year = pageYear(page)
    if (year !== null) {
      min = min === null ? year : Math.min(min, year)
      max = max === null ? year : Math.max(max, year)
    }
  }

  const types = PAGE_TYPES.filter((t) => presentTypes.has(t))
  const tags = [...presentTags].sort()
  const yearBounds = min !== null && max !== null ? { min, max } : null

  return { types, tags, yearBounds }
}
