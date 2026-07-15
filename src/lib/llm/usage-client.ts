import type { UsageSummary } from "./usage-summary"

/**
 * Browser-side caller for GET /api/usage (M12 Task 12). The spend summary is
 * computed entirely server-side (the browser never reads the usage ledger or
 * LLM settings itself — local-runtime pivot); this wrapper just fetches the
 * already-aggregated `{summary, budgetUsd}`. Type-only import of `UsageSummary`
 * keeps this module free of any server/provider code (browser-purity gate).
 */

export interface UsageResponse {
  summary: UsageSummary
  budgetUsd: number
}

export async function loadUsage(fetchFn: typeof fetch = fetch): Promise<UsageResponse> {
  const res = await fetchFn("/api/usage", { method: "GET" })
  if (!res.ok) {
    let message = `usage load failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON body; fall back to the generic status message */
    }
    throw new Error(message)
  }
  return (await res.json()) as UsageResponse
}
