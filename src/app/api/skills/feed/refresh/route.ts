import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn } from "@/lib/papers/node-search"
import { runFeed } from "@/lib/skills/feed"
import { withLedger } from "@/lib/runs/ledger"

/**
 * POST /api/skills/feed/refresh — body `{}`, streams NDJSON progress
 * (`{type:"progress", stage}` once per funnel stage, via runFeed's `onStage`)
 * terminating in the full FeedResult as the result event. Builds its own deps
 * server-side (per M11's local-runtime pivot: the browser never runs skills or
 * holds LLM keys) — getServerVault() (via ndjsonSkillRoute), loadSettings(vault),
 * and a Node searchFn — so the client sends nothing. `setSkillTestOverrides` lets
 * tests inject a MockProvider/fake searchFn instead of nodeSearchFn()'s real
 * network calls. Mirrors src/app/api/skills/trending/refresh/route.ts exactly.
 */
export const POST = ndjsonSkillRoute<Record<string, never>>(async (_input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()

  return withLedger(vault, { orchestrator: "feed-refresh", trigger: "user" }, async () => {
    const result = await runFeed(vault, {
      searchFn: overrides.searchFn ?? nodeSearchFn(),
      settings,
      providerOverride: overrides.providerOverride,
      onStage: (stage) => emit({ type: "progress", stage }),
    })
    return { result, status: "ok", costUsd: result.costUsd, meta: { itemCount: result.items.length } }
  })
})
