import type { Bundle } from "../vault/bundle"
import type { WikiPage } from "../vault/types"

export type PaperShelfStatus = "saved" | "enriched" | "ingested"

export interface ShelfEntry {
  id: string // bundle id, e.g. "wiki/papers/arxiv-2409-08710"
  slug: string // last segment, for /paper/<slug>
  title: string // raw frontmatter title (caller renders via displayTitle)
  tags: string[]
  status: PaperShelfStatus
  tldr: string | null // frontmatter.tldr, else first body text line, else null
  updated: string
}

export interface SectionEntry {
  id: string
  title: string
  updated: string
  status?: string
  depth?: string
}

export interface DashboardSection {
  type: string
  label: string
  entries: SectionEntry[]
  total: number
}

export interface RecentEntry {
  id: string
  title: string
  type: string
  updated: string
}

export interface WikiStats {
  papers: { saved: number; enriched: number; ingested: number; total: number }
  knowledge: number // concept+method+finding+comparison+topic
  ideas: number
  notes: number
}

export interface WikiDashboard {
  stats: WikiStats
  shelves: Record<PaperShelfStatus, ShelfEntry[]>
  sections: DashboardSection[] // empty sections omitted
  recent: RecentEntry[]
}

const SHELF_STATUSES: PaperShelfStatus[] = ["saved", "enriched", "ingested"]

const KNOWLEDGE_TYPES = new Set(["concept", "method", "finding", "comparison", "topic"])

const SECTION_ORDER: Array<{ type: string; label: string }> = [
  { type: "concept", label: "Concepts" },
  { type: "method", label: "Methods" },
  { type: "finding", label: "Findings" },
  { type: "comparison", label: "Comparisons" },
  { type: "topic", label: "Topics" },
  { type: "idea", label: "Ideas" },
  { type: "note", label: "Notes" },
  // Saved chat answers (SP5): user-generated like notes, so it sits right
  // after them rather than among the paper-derived knowledge types above.
  { type: "query", label: "Saved answers" },
  { type: "author", label: "Authors" },
]

function slugOf(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1]
}

function paperStatusOf(page: WikiPage): PaperShelfStatus {
  const status = page.frontmatter.status
  if (status === "enriched" || status === "ingested") return status
  // Missing or unrecognized status is the oldest tier — never hide a paper.
  return "saved"
}

/** `[[slug]]` / `[[slug|label]]` wikilink markup is meaningless on a dashboard
 * card — render the link's visible text only. */
function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug: string, label?: string) => label ?? slug)
}

function tldrOf(page: WikiPage): string | null {
  const fmTldr = page.frontmatter.tldr
  if (typeof fmTldr === "string" && fmTldr.trim()) return fmTldr.trim()
  for (const rawLine of page.body.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith("#")) continue
    return stripWikilinks(line)
  }
  return null
}

function compareByUpdatedDescThenIdAsc(a: { updated: string; id: string }, b: { updated: string; id: string }) {
  if (a.updated !== b.updated) return a.updated > b.updated ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function deriveWikiDashboard(
  bundle: Bundle,
  opts?: { shelfLimit?: number; sectionLimit?: number; recentLimit?: number },
): WikiDashboard {
  const shelfLimit = opts?.shelfLimit ?? 12
  const sectionLimit = opts?.sectionLimit ?? 6
  const recentLimit = opts?.recentLimit ?? 10

  const shelfBuckets: Record<PaperShelfStatus, ShelfEntry[]> = { saved: [], enriched: [], ingested: [] }
  const paperCounts: Record<PaperShelfStatus, number> = { saved: 0, enriched: 0, ingested: 0 }
  const sectionBuckets = new Map<string, SectionEntry[]>()
  const recentAll: RecentEntry[] = []
  const knowledgeStat = { concept: 0, method: 0, finding: 0, comparison: 0, topic: 0 }
  let ideasCount = 0
  let notesCount = 0

  for (const page of bundle.pages.values()) {
    const type = page.frontmatter.type
    const updated = page.frontmatter.updated
    const title = page.frontmatter.title

    recentAll.push({ id: page.id, title, type, updated })

    if (type === "paper") {
      const status = paperStatusOf(page)
      paperCounts[status]++
      shelfBuckets[status].push({
        id: page.id,
        slug: slugOf(page.id),
        title,
        tags: page.frontmatter.tags,
        status,
        tldr: tldrOf(page),
        updated,
      })
      continue
    }

    if (KNOWLEDGE_TYPES.has(type)) {
      knowledgeStat[type as keyof typeof knowledgeStat]++
    } else if (type === "idea") {
      ideasCount++
    } else if (type === "note") {
      notesCount++
    }

    const entry: SectionEntry = { id: page.id, title, updated }
    const status = page.frontmatter.status
    if (typeof status === "string") entry.status = status
    const depth = page.frontmatter.depth
    if (typeof depth === "string") entry.depth = depth

    const bucket = sectionBuckets.get(type)
    if (bucket) bucket.push(entry)
    else sectionBuckets.set(type, [entry])
  }

  for (const status of SHELF_STATUSES) {
    shelfBuckets[status].sort(compareByUpdatedDescThenIdAsc)
    if (Number.isFinite(shelfLimit)) shelfBuckets[status] = shelfBuckets[status].slice(0, shelfLimit)
  }

  const sections: DashboardSection[] = []
  for (const { type, label } of SECTION_ORDER) {
    const entries = sectionBuckets.get(type)
    if (!entries || entries.length === 0) continue
    entries.sort(compareByUpdatedDescThenIdAsc)
    sections.push({
      type,
      label,
      entries: Number.isFinite(sectionLimit) ? entries.slice(0, sectionLimit) : entries,
      total: entries.length,
    })
  }

  recentAll.sort(compareByUpdatedDescThenIdAsc)
  const recent = Number.isFinite(recentLimit) ? recentAll.slice(0, recentLimit) : recentAll

  const knowledgeTotal =
    knowledgeStat.concept + knowledgeStat.method + knowledgeStat.finding + knowledgeStat.comparison + knowledgeStat.topic

  return {
    stats: {
      papers: { ...paperCounts, total: paperCounts.saved + paperCounts.enriched + paperCounts.ingested },
      knowledge: knowledgeTotal,
      ideas: ideasCount,
      notes: notesCount,
    },
    shelves: shelfBuckets,
    sections,
    recent,
  }
}
