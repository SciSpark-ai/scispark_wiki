import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import { DAILY_BUDGET, MIN_GAP_MS, type Chattiness } from "./settings"
import { evaluateTriggers, viewedCompanionEvents, EVENT_MAX_AGE_MS, type TriggerState } from "./triggers"

export const DELIVERY_PATH = ".scispark/companion-delivery.json"
const DAY = 24 * 60 * 60_000
const LedgerSchema = z.object({
  version: z.literal(1),
  records: z.array(z.object({ key: z.string().min(1).max(16_000), trigger: z.string(), ts: z.iso.datetime(), viewed: z.boolean().optional() }).strict()).max(2048),
}).strict()
const queues = new WeakMap<VaultStorage, Promise<void>>()

/** One local server owns a vault. Serialize its tabs' claims before generating
 * text, and persist via the storage's atomic write. This is operational delivery
 * bookkeeping, not research content or learned preferences. A failed delivery
 * remains consumed: quiet at-most-once delivery is preferable to repeated nudges.
 * Corrupt/unwritable records fail closed; never erase them or reset the budget.
 */
export async function claimCompanionEvent(storage: VaultStorage, state: TriggerState, chattiness: Chattiness) {
  const previous = queues.get(storage) ?? Promise.resolve()
  const work = previous.then(async () => {
    const raw = await storage.read(DELIVERY_PATH)
    const ledger = raw === null ? { version: 1 as const, records: [] } : LedgerSchema.parse(JSON.parse(raw))
    const records = ledger.records.filter((r) => state.nowMs - Date.parse(r.ts) <= EVENT_MAX_AGE_MS + DAY)
    const consumedKeys = new Set(records.map((r) => r.key))
    const viewed = viewedCompanionEvents({ ...state, consumedKeys })
      .filter((r) => !consumedKeys.has(r.key))
    if (viewed.length) {
      for (const record of viewed) {
        records.push({ ...record, ts: new Date(state.nowMs).toISOString(), viewed: true })
        consumedKeys.add(record.key)
      }
      await storage.write(DELIVERY_PATH, JSON.stringify(LedgerSchema.parse({ version: 1, records })))
    }
    const recent = records.filter((r) => !r.viewed && state.nowMs - Date.parse(r.ts) < DAY)
    if (recent.length >= DAILY_BUDGET[chattiness]) return null
    if (recent.some((r) => state.nowMs - Date.parse(r.ts) < MIN_GAP_MS[chattiness])) return null
    const lastShownTs = { ...state.lastShownTs }
    for (const record of records) {
      if (record.viewed) continue
      if (!lastShownTs[record.trigger] || lastShownTs[record.trigger] < record.ts) lastShownTs[record.trigger] = record.ts
    }
    const fired = evaluateTriggers({ ...state, consumedKeys, lastShownTs })
    if (!fired) return null
    const next = LedgerSchema.parse({ version: 1, records: [...records, { key: fired.eventKey, trigger: fired.id, ts: new Date(state.nowMs).toISOString() }] })
    await storage.write(DELIVERY_PATH, JSON.stringify(next))
    return fired
  })
  queues.set(storage, work.then(() => undefined, () => undefined))
  return work
}
