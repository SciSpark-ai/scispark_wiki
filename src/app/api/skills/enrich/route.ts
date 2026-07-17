import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { runSkill } from "@/lib/skills/runner"
import { enrichSkill } from "@/lib/skills/enrich"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import type { WikiPage } from "@/lib/vault/types"
import { applyChangeset } from "@/lib/vault/changesets"
import { writeIndex } from "@/lib/vault/index-builder"
import { paperRecordFromFrontmatter } from "@/lib/papers/resolve"
import { buildEnrichMergeChangeset } from "@/lib/papers/enrich-apply"

export interface EnrichRouteResult {
  applied: boolean
  costUsd: number
  tldr?: string
  tags?: string[]
}

/**
 * Finds a saved/enriched/ingested paper page by its sanitized slug
 * (`paperSlug` — the same stem `buildPaperPage`/`buildSaveStubChangeset`
 * write under `<routing dir>/<slug>.md`). Matches on the id's final path
 * segment rather than requiring `loadRouting`, so a custom `schema.md`
 * routing for the `paper` type is honored automatically. Restricted to
 * `frontmatter.type === "paper"` so it can never match a same-named
 * author/concept/etc. page; ties (should never happen in practice) break on
 * the alphabetically smallest id, mirroring `loadBundle`'s wikilink
 * suffix-index tie-break.
 */
function findPaperPage(bundle: Bundle, slug: string): WikiPage | null {
  const suffix = `/${slug}`
  const matches = [...bundle.pages.values()]
    .filter((p) => p.frontmatter.type === "paper" && (p.id === slug || p.id.endsWith(suffix)))
    .sort((a, b) => a.id.localeCompare(b.id))
  return matches[0] ?? null
}

/**
 * POST /api/skills/enrich — body `{slug}`, JSON result
 * `{applied, costUsd, tldr?, tags?}`. Loads the paper page by slug, builds a
 * wiki index (id/title/type for every OTHER page — the paper never gets
 * offered a link to itself), runs the `fast`-tier Enrich Skill
 * (metadata+abstract+index -> tldr/tags/relatedPageIds), drops any
 * `relatedPageIds` the skill invented that aren't actually in the index,
 * merges the result into the page's frontmatter via
 * `buildEnrichMergeChangeset`, and applies it as one atomic changeset
 * (index.md rebuilt after). Every non-happy path (no matching page, skill
 * run not `ok`, page vanished between load and apply) degrades to
 * `{applied: false, costUsd}` rather than throwing — enrich is a background
 * nicety that must never break the save flow it rides along with.
 * `setSkillTestOverrides` injects a MockProvider in tests.
 */
export const POST = jsonSkillRoute<{ slug: string }, EnrichRouteResult>(async ({ slug }, vault) => {
  const overrides = getSkillTestOverrides()
  const bundle = await loadBundle(vault)
  const paperPage = findPaperPage(bundle, slug)
  if (paperPage === null) return { applied: false, costUsd: 0 }

  const wikiIndex = [...bundle.pages.values()]
    .filter((p) => p.id !== paperPage.id)
    .map((p) => ({ id: p.id, title: p.frontmatter.title, type: p.frontmatter.type }))

  const settings = await loadSettings(vault)
  const paper = paperRecordFromFrontmatter(paperPage.frontmatter)

  const run = await runSkill({
    skill: enrichSkill,
    input: { paper, wikiIndex },
    storage: vault,
    settings,
    providerOverride: overrides.providerOverride,
  })

  if (run.status !== "ok" || run.output === undefined) {
    return { applied: false, costUsd: run.costUsd }
  }

  const validIds = new Set(bundle.pages.keys())
  const relatedPageIds = run.output.relatedPageIds.filter((id) => validIds.has(id))

  // Re-read from disk (not the bundle snapshot) so `before` matches exactly
  // what applyChangeset's conflict check compares against.
  const currentContent = await vault.read(paperPage.path)
  if (currentContent === null) return { applied: false, costUsd: run.costUsd }

  const changeset = buildEnrichMergeChangeset(paperPage.id, currentContent, {
    ...run.output,
    relatedPageIds,
  })
  await applyChangeset(vault, changeset)
  await writeIndex(vault, await loadBundle(vault))

  return { applied: true, costUsd: run.costUsd, tldr: run.output.tldr, tags: run.output.tags }
})
