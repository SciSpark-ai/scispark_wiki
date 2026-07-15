import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { summarizeUsage } from "@/lib/llm/usage-summary"
import type { UsageRecord } from "@/lib/llm/metering"

/**
 * GET /api/usage — aggregates the whole usage ledger into a spend summary for
 * the client SpendPanel (M12 Task 12). Lists every `.scispark/usage/*.jsonl`
 * day-file (the path convention `metering.ts` writes), reads + parses each into
 * `UsageRecord`s (tolerant: a corrupt/partial line is skipped, never fatal),
 * runs the pure `summarizeUsage`, and returns it alongside the current
 * `dailyBudgetUsd`.
 *
 * The response is derived ONLY from usage records + `dailyBudgetUsd`; it never
 * touches or echoes `settings.keys`, so no API-key material can leak to the
 * browser (asserted in usage-api.test.ts). Node runtime — reads the server
 * vault via `getServerVault()`.
 */
export const runtime = "nodejs"

const USAGE_PREFIX = ".scispark/usage/"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export async function GET(): Promise<Response> {
  try {
    const vault = await getServerVault()
    const dayFiles = (await vault.list(USAGE_PREFIX)).filter((p) => p.endsWith(".jsonl"))

    const records: UsageRecord[] = []
    for (const path of dayFiles) {
      const raw = await vault.read(path)
      if (raw == null) continue
      for (const line of raw.split("\n")) {
        if (line.trim().length === 0) continue
        try {
          const parsed = JSON.parse(line)
          // Skip non-object values (null, string, number, array) and unparseable
          // lines — a single corrupt line must not sink the whole aggregation.
          if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            records.push(parsed as UsageRecord)
          }
        } catch {
          continue
        }
      }
    }

    const summary = summarizeUsage(records, new Date())
    const settings = await loadSettings(vault)
    return jsonResponse(200, { summary, budgetUsd: settings.dailyBudgetUsd })
  } catch (err) {
    return jsonResponse(500, { error: err instanceof Error ? err.message : String(err) })
  }
}
