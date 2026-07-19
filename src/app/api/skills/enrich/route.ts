import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadSettings } from "@/lib/llm/settings"
import { runSkill } from "@/lib/skills/runner"
import { enrichSkill } from "@/lib/skills/enrich"
import { loadBundle } from "@/lib/vault/bundle"
import { applyChangeset } from "@/lib/vault/changesets"
import { writeIndex } from "@/lib/vault/index-builder"
import { paperRecordFromFrontmatter, extractAbstractFromBody } from "@/lib/papers/resolve"
import { buildEnrichMergeChangeset } from "@/lib/papers/enrich-apply"
// findPaperPage (routing-tolerant paper-page lookup by slug) is shared with
// `/paper/[key]`'s own page-state resolution (I2, whole-branch review) —
// one implementation instead of two that could drift.
import { findPaperPage } from "@/lib/papers/page-state"

export interface EnrichRouteResult {
  applied: boolean
  costUsd: number
  tldr?: string
  tags?: string[]
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
 *
 * **In-flight dedup**: concurrent enrich requests for the same slug share
 * one skill run (module-level map, mirroring `generateDigest`'s in-flight
 * pattern). Enrich fires from several places — savePaper's background call
 * on a feed-card save, and the paper page's automatic run when it shows a
 * saved paper without a TL;DR — and a user can hit both within seconds
 * (save on the feed, immediately open the paper), which would otherwise
 * charge the skill twice and race two changesets onto the same page.
 */
const inFlightBySlug = new Map<string, Promise<EnrichRouteResult>>()

export const POST = jsonSkillRoute<{ slug: string }, EnrichRouteResult>(({ slug }, vault) => {
  const existing = inFlightBySlug.get(slug)
  if (existing) return existing
  const run = runEnrichForSlug(slug, vault).finally(() => inFlightBySlug.delete(slug))
  inFlightBySlug.set(slug, run)
  return run
})

async function runEnrichForSlug(slug: string, vault: VaultStorage): Promise<EnrichRouteResult> {
  const overrides = getSkillTestOverrides()
  const bundle = await loadBundle(vault)
  const paperPage = findPaperPage(bundle, slug)
  if (paperPage === null) return { applied: false, costUsd: 0 }

  const wikiIndex = [...bundle.pages.values()]
    .filter((p) => p.id !== paperPage.id)
    .map((p) => ({ id: p.id, title: p.frontmatter.title, type: p.frontmatter.type }))

  const settings = await loadSettings(vault)
  const paper = paperRecordFromFrontmatter(paperPage.frontmatter)
  // A paper page's abstract lives ONLY in the body's `## Abstract` section
  // (buildPaperPage), never in frontmatter — so backfill it before the skill
  // runs, or enrichSkill sees "Abstract: (none)" and generates tldr/tags from
  // title+authors+venue alone.
  if (paper.abstract === undefined || paper.abstract.trim() === "") {
    paper.abstract = extractAbstractFromBody(paperPage.body)
  }

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

  // Validate against real page ids, EXCLUDING the paper's own id — so a
  // hallucinated self-reference can never become a self-link (the paper is
  // also excluded from the index the LLM sees, but guard the output too).
  const validIds = new Set([...bundle.pages.keys()].filter((id) => id !== paperPage.id))
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
}
