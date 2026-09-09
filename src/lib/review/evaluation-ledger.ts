/** Offline/live evaluation accounting, NOT the future production daily coordinator.
 * The host must hold the evaluation directory's cross-process exclusive lock. */
import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { LLMUsage } from "../llm/types"
import { priceTokenUsage, ScopedPriceSchema, type ScopedPrice } from "../llm/scoped-pricing"

const AttemptSchema = z.object({
  id: z.string(), stage: z.string(), reservedUsd: z.number().finite().nonnegative(),
  state: z.enum(["reserved", "settled", "uncertain"]),
  costUsd: z.number().finite().nonnegative().nullable(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(),
    cachedInputTokens: z.number().optional(), reasoningTokens: z.number().optional(), reported: z.boolean().optional(),
  }).optional(),
  startedAt: z.string(), finishedAt: z.string().optional(),
})
const LedgerSchema = z.object({ version: z.literal(1), allowanceUsd: z.literal(2), price: ScopedPriceSchema,
  attempts: z.array(AttemptSchema) }).strict()
export type EvaluationLedgerState = z.infer<typeof LedgerSchema>
const FILE = ".scispark/review-evaluation/allowance.json"

export class EvaluationLedger {
  private constructor(private storage: VaultStorage, public readonly state: EvaluationLedgerState) {}

  static async open(storage: VaultStorage, price: ScopedPrice): Promise<EvaluationLedger> {
    const raw = await storage.read(FILE)
    const state = raw === null ? { version: 1 as const, allowanceUsd: 2 as const, price: ScopedPriceSchema.parse(price), attempts: [] }
      : LedgerSchema.parse(JSON.parse(raw))
    if (JSON.stringify(state.price) !== JSON.stringify(price)) throw new Error("Evaluation pricing changed; approval is required")
    const ledger = new EvaluationLedger(storage, state)
    await ledger.persist()
    return ledger
  }

  totals() {
    const knownUsd = this.state.attempts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
    const heldUsd = this.state.attempts.filter((a) => a.state !== "settled")
      .reduce((sum, a) => sum + a.reservedUsd, 0)
    return { knownUsd, heldUsd, remainingUsd: Math.max(0, 2 - knownUsd - heldUsd) }
  }

  async reserve(stage: string, reservedUsd: number): Promise<string> {
    if (!Number.isFinite(reservedUsd) || reservedUsd < 0) throw new Error("Invalid reservation")
    if (this.state.attempts.some((a) => a.state !== "settled")) throw new Error("An earlier attempt has uncertain billing; do not replay it automatically")
    if (this.state.attempts.some((a) => a.costUsd !== null && a.costUsd > a.reservedUsd)) throw new Error("An earlier attempt exceeded its reservation; review pricing before continuing")
    if (reservedUsd > this.totals().remainingUsd) throw new Error("The $2 total evaluation allowance cannot cover this attempt")
    const id = `attempt-${this.state.attempts.length + 1}`
    this.state.attempts.push({ id, stage, reservedUsd, costUsd: null, state: "reserved", startedAt: new Date().toISOString() })
    await this.persist() // Must succeed before sending anything to the provider.
    return id
  }

  async settle(id: string, usage?: LLMUsage): Promise<void> {
    const attempt = this.state.attempts.find((a) => a.id === id)
    if (!attempt || attempt.state !== "reserved") throw new Error("Invalid or already reconciled attempt")
    const costUsd = usage ? priceTokenUsage(usage, this.state.price.rates) : null
    Object.assign(attempt, { state: costUsd === null ? "uncertain" : "settled", costUsd,
      ...(usage ? { usage } : {}), finishedAt: new Date().toISOString() })
    await this.persist()
    if (costUsd === null) throw new Error("Provider billing is uncertain; the reserved amount is held and further calls are paused")
    if (costUsd > attempt.reservedUsd) throw new Error("Provider usage exceeded the reserved ceiling; further work requires review")
  }

  private persist() { return this.storage.write(FILE, JSON.stringify(this.state, null, 2)) }
}
