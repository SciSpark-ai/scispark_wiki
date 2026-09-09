import { withLedger } from "@/lib/runs/ledger"
import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadSettings } from "@/lib/llm/settings"
import { nodeTopWorksFn, nodeCountFn, nodeTopicGroupFn, nodeTopicFieldGroupFn } from "@/lib/papers/node-search"

import { maybeAutoRefreshTrending, REFRESH_FAILURE_PATH } from "@/lib/trending/auto-refresh"

/** Best-effort read of the failure marker's `lastError`, for the ledger's "failed" reason. */
async function readFailureReason(storage: VaultStorage): Promise<string | undefined> {
  try {
    const raw = await storage.read(REFRESH_FAILURE_PATH)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw) as { lastError?: unknown }
    return typeof parsed.lastError === "string" ? parsed.lastError : undefined
  } catch {
    return undefined
  }
}

/**
 * POST /api/skills/trending/auto-refresh — body `{}`, JSON result
 * `{result: "refreshed"|"fresh"|"no-fields"}`. The home page's v1 "cron":
 * fire-and-forget on app open, refreshing the cached trending board only
 * when it's stale or anchor-scope-mismatched. Builds its own deps server-side
 * (getServerVault() via jsonSkillRoute, loadSettings(vault), an entity-scoped
 * OpenAlex works retriever, a real OpenAlex work counter, and the two
 * `group_by` groupers) exactly
 * like the refresh route, so the browser never needs its own
 * settings/searchFn/counter wiring.
 */
export const POST = jsonSkillRoute<Record<string, never>, "refreshed" | "fresh" | "no-fields" | "backoff" | "failed">(async (_input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()
  return withLedger(vault, { orchestrator: "trending-refresh", trigger: "user" }, async () => {
    const result = await maybeAutoRefreshTrending(vault, {
    topWorksFn: overrides.topWorksFn ?? nodeTopWorksFn(),
    countFn: overrides.countFn ?? nodeCountFn(),
    topicGroupFn: overrides.topicGroupFn ?? nodeTopicGroupFn(),
    fieldGroupFn: overrides.fieldGroupFn ?? nodeTopicFieldGroupFn(),
    settings,
    providerOverride: overrides.providerOverride,
    })
    if (result === "refreshed") return { result, status: "ok" }
    if (result === "failed") return { result, status: "failed", reason: await readFailureReason(vault) }
    return { result, status: "skipped", reason: result }
  })
})
