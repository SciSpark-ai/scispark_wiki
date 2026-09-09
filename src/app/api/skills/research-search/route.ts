import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeResearchSearchFn } from "@/lib/papers/node-search"
import { askChat } from "@/lib/chat/orchestrator"
import type { ResearchSearchInput } from "@/lib/skills/research-search-contract"

export const POST = ndjsonSkillRoute<ResearchSearchInput>(async (input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  if (typeof input?.query !== "string" || !input.query.trim()) throw new Error("Enter a research question")
  const turn = await askChat(vault, {
    input: { sessionId: input.sessionId ?? null, question: input.query, readSourcesOnly: false, mode: "search", sources: input.sources, operationId: input.operationId },
    settings,
    providerOverride: overrides.providerOverride,
    searchFn: overrides.searchFn ?? nodeResearchSearchFn({ reportErrors: true }),
    onProgress: (stage) => emit({ type: "progress", stage }),
  })
  if (turn.message.error) throw new Error(turn.message.error)
  const block = turn.message.blocks?.find((item) => item.type === "paper-results")
  if (block?.type !== "paper-results") throw new Error("Saved search result is unavailable")
  return { ...block.result, sessionId: turn.sessionId }
})
