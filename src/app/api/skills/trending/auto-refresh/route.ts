import { jsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import type { VaultStorage } from "@/lib/vault/storage"
import { loadSettings } from "@/lib/llm/settings"
import { nodeSearchFn, nodeCountFn, nodeGroupFn } from "@/lib/papers/node-search"
import { withLedger } from "@/lib/runs/ledger"

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
 * `{result: "refreshed"|"fresh"|"no-fields"|"backoff"|"failed"}`. The home
 * page's v1 "cron": fire-and-forget on app open, refreshing the cached
 * trending dashboard only when it's stale or field-set-mismatched.
 * "backoff"/"failed" come from maybeAutoRefreshTrending's failure-marker
 * mechanism (see its JSDoc) — a failed orchestrator run never rethrows here,
 * it just reports its status like any other outcome. Builds its own deps
 * server-side (getServerVault() via jsonSkillRoute, loadSettings(vault), a
 * Node searchFn, a real per-week OpenAlex counter) exactly like the refresh
 * route, so the browser never needs its own settings/searchFn/countFn wiring.
 */
export const POST = jsonSkillRoute<Record<string, never>, "refreshed" | "fresh" | "no-fields" | "backoff" | "failed">(async (_input, vault) => {
  const settings = await loadSettings(vault)
  const overrides = getSkillTestOverrides()

  return withLedger(vault, { orchestrator: "trending-refresh", trigger: "user" }, async () => {
    const result = await maybeAutoRefreshTrending(vault, {
      searchFn: overrides.searchFn ?? nodeSearchFn(),
      countFn: overrides.countFn ?? nodeCountFn(),
      groupFn: overrides.groupFn ?? nodeGroupFn(),
      settings,
      providerOverride: overrides.providerOverride,
    })

    if (result === "refreshed") return { result, status: "ok" }
    if (result === "failed") return { result, status: "failed", reason: await readFailureReason(vault) }
    // "fresh" | "no-fields" | "backoff"
    return { result, status: "skipped", reason: result }
  })
})
