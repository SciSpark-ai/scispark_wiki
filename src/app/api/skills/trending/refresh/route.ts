import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn, nodeCountFn, nodeGroupFn } from "@/lib/papers/node-search"

import { runTrendingDashboard } from "@/lib/trending/dashboard"
import type { TrackedField } from "@/lib/trending/fields"

interface RefreshInput {
  fields: TrackedField[]
}

/**
 * POST /api/skills/trending/refresh — body `{fields}`, streams NDJSON
 * progress (`{type:"progress", field}` per field, via runTrendingDashboard's
 * onProgress) terminating in the full TrendingDashboard as the result event.
 * Builds its own deps server-side (per M11's local-runtime pivot: the browser
 * never runs skills or holds LLM keys) — getServerVault() (via
 * ndjsonSkillRoute), loadSettings(vault), a Node searchFn, and a real
 * per-week OpenAlex counter (countOpenAlexWorks) for weekly-volume
 * aggregation — so the client only ever sends the tracked fields.
 * `setSkillTestOverrides` lets tests inject a MockProvider/fake
 * searchFn/countFn instead of nodeSearchFn()'s/countOpenAlexWorks's real
 * network calls.
 */
export const POST = ndjsonSkillRoute<RefreshInput>(async (input, vault, emit) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return runTrendingDashboard(vault, {
    fields: input.fields,
    searchFn: overrides.searchFn ?? nodeSearchFn(),
    countFn: overrides.countFn ?? nodeCountFn(),
    groupFn: overrides.groupFn ?? nodeGroupFn(),
    settings,
    providerOverride: overrides.providerOverride,
    onProgress: (field) => emit({ type: "progress", field }),
  })
})
