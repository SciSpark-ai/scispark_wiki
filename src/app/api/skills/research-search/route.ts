import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeResearchSearchFn } from "@/lib/papers/node-search"
import { runResearchSearch } from "@/lib/skills/research-search"
import type { ResearchSearchInput } from "@/lib/skills/research-search-contract"

export const POST = ndjsonSkillRoute<ResearchSearchInput>(async (input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return runResearchSearch(vault, input, {
    settings,
    providerOverride: overrides.providerOverride,
    searchFn: overrides.searchFn ?? nodeResearchSearchFn(),
    onStage: (stage) => emit({ type: "progress", stage }),
  })
})
