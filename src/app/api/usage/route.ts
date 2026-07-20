import { getServerVault } from "@/lib/server/vault"
import { loadSettings } from "@/lib/llm/settings"
import { summarizeUsage } from "@/lib/llm/usage-summary"
import type { UsageRecord } from "@/lib/llm/metering"
import { summarizeAcceptance } from "@/lib/runs/acceptance"
import { readLedger } from "@/lib/runs/ledger"
import { readRecentEvents } from "@/lib/events/log"
import { parseUndoneChangesetIds } from "@/lib/wiki/review-queue"
import type { Changeset } from "@/lib/vault/types"

/**
 * GET /api/usage — aggregates the whole usage ledger into a spend summary for
 * the client SpendPanel (M12 Task 12). Lists every `.scispark/usage/*.jsonl`
 * day-file (the path convention `metering.ts` writes), reads + parses each into
 * `UsageRecord`s (tolerant: a corrupt/partial line is skipped, never fatal),
 * runs the pure `summarizeUsage`, and returns it alongside the current
 * `dailyBudgetUsd`.
 *
 * Also aggregates changeset-revert telemetry (Task 4): every `.scispark/changesets/*.json`
 * audit record (id + skill) is joined against the set of reverted ids — the
 * UNION of `changeset_revert` events and ingest's `log.md` "undo" entries
 * (`parseUndoneChangesetIds`), since `undoIngest` writes both and a revert must
 * never be double-counted — via the pure `summarizeAcceptance`, giving a
 * per-skill accept-rate and cost-per-accepted-change. `recentRuns` surfaces the
 * last 20 orchestrator-run ledger records (Task 1's `readLedger`).
 *
 * The response is derived ONLY from usage records + `dailyBudgetUsd` +
 * changeset/event/ledger metadata; it never touches or echoes `settings.keys`,
 * so no API-key material can leak to the browser (asserted in usage-api.test.ts).
 * Node runtime — reads the server vault via `getServerVault()`.
 */
export const runtime = "nodejs"

const USAGE_PREFIX = ".scispark/usage/"
const CHANGESET_PREFIX = ".scispark/changesets/"

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

    // Changeset audit records (id + skill) — skip corrupt/unparseable ones.
    const changesetPaths = (await vault.list(CHANGESET_PREFIX)).filter((p) => p.endsWith(".json"))
    const changesets: Array<{ id: string; skill: string }> = []
    for (const path of changesetPaths) {
      const raw = await vault.read(path)
      if (raw == null) continue
      try {
        const cs = JSON.parse(raw) as Changeset
        changesets.push({ id: cs.id, skill: cs.skill })
      } catch {
        continue
      }
    }

    // Reverted ids = changeset_revert events ∪ ingest's log.md undo entries —
    // undoIngest writes both, so union (not concatenate) avoids double-counting.
    const events = await readRecentEvents(vault, { limit: 5000 })
    const revertedIds = new Set<string>()
    for (const e of events) {
      if (e.type === "changeset_revert") revertedIds.add(e.changesetId)
    }
    const logMd = await vault.read("log.md")
    for (const id of parseUndoneChangesetIds(logMd ?? "")) revertedIds.add(id)

    const acceptance = summarizeAcceptance(changesets, revertedIds, records)
    const recentRuns = await readLedger(vault, { limit: 20 })

    return jsonResponse(200, { summary, budgetUsd: settings.dailyBudgetUsd, acceptance, recentRuns })
  } catch (err) {
    return jsonResponse(500, { error: err instanceof Error ? err.message : String(err) })
  }
}
