import { composePage, slugifyTitle, type PageDraft } from "../wiki/authoring"
import { sanitizeSlugList } from "../skills/ingest"
import type { Frontmatter } from "../vault/types"

export type IdeaStatus = "sparked" | "in-progress" | "scooped" | "abandoned"
export type IdeaDepth = "quick" | "deep"

export interface IdeaPageInput {
  /** Seeds the path/title slug (not necessarily the same string as `title`). */
  slugSeed: string
  title: string
  status: IdeaStatus
  depth: IdeaDepth
  /** Wiki ids of grounding papers/concepts -> related[], reduced to bare slugs. */
  groundingPageIds: string[]
  /** Composed markdown card body. */
  body: string
  today: string
}

export interface IdeaPageDraft {
  path: string
  frontmatter: Frontmatter
  content: string
}

/**
 * Builds an `idea` wiki page draft (path + frontmatter + serialized content)
 * from a Spark run's assembled body. Pure — does not touch storage; callers
 * apply it via `applyChangeset` (see M1 changesets / M4 authoring pattern).
 *
 * Path: `wiki/ideas/idea-<slugifyTitle(slugSeed)>.md`. Frontmatter follows the
 * standard contract (type/title/created/updated/tags/related/sources) plus
 * two Spark-specific custom keys, `status` and `depth`, per the M9 design
 * (docs/design + 2026-07-13-m9-spark.md Task 1).
 */
export function buildIdeaPage(input: IdeaPageInput): IdeaPageDraft {
  const slug = slugifyTitle(input.slugSeed)
  const path = `wiki/ideas/idea-${slug}.md`

  const frontmatter: Frontmatter = {
    type: "idea",
    title: input.title,
    created: input.today,
    updated: input.today,
    tags: [],
    related: sanitizeSlugList(input.groundingPageIds),
    sources: [],
    status: input.status,
    depth: input.depth,
  }

  const draft: PageDraft = { path, frontmatter, body: input.body }
  const content = composePage(draft)

  return { path, frontmatter, content }
}
