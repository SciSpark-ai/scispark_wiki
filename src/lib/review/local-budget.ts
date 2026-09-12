import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { VaultStorage } from "../vault/storage"
import type { LLMProvider, LLMResult } from "../llm/types"
import { completeStructured } from "../llm/structured"
import { Meter } from "../llm/metering"
import { withVaultExclusive } from "../vault/exclusive"
import type { ReviewBrief } from "./contracts"
import { hashReviewData } from "./budget"

const Attempt = z.object({ id: z.string(), step: z.string(), signature: z.string(),
  state: z.enum(["reserved", "settled", "uncertain", "acknowledged"]), result: z.unknown().optional() })
const path = (id: string) => `.scispark/reviews/${id}/engine-attempts.json`
async function read(storage: VaultStorage, id: string) {
  const raw = await storage.read(path(id))
  return raw === null ? [] : z.array(Attempt).parse(JSON.parse(raw))
}
export async function localReviewSpend(storage: VaultStorage, id: string) {
  const rows = await read(storage, id)
  return { calls: rows.length, uncertain: rows.some((r) => r.state === "reserved" || r.state === "uncertain") }
}
export async function acknowledgeLocalReview(storage: VaultStorage, id: string) {
  await withVaultExclusive(storage, "local-engine", async () => {
    const rows = await read(storage, id)
    rows.forEach((r) => { if (r.state === "reserved" || r.state === "uncertain") r.state = r.result ? "settled" : "acknowledged" })
    await storage.write(path(id), JSON.stringify(rows))
  })
}
/** Retains the existing pipeline/checkpoint architecture. Local agents receive
 * selected evidence as input, never filesystem tools or a vault path. */
export async function localReviewComplete<T>(storage: VaultStorage, id: string, brief: ReviewBrief,
  step: string, prompt: string, schema: z.ZodType<T>, tokens: number,
  guard: () => Promise<void>, provider: LLMProvider): Promise<T> {
  return withVaultExclusive(storage, "local-engine", async () => {
    await guard()
    const rows = await read(storage, id)
    const persist = () => storage.write(path(id), JSON.stringify(rows))
    const wrapped: LLMProvider = { id: provider.id, billingMode: "subscription", complete: async (model, request) => {
      await guard()
      const signature = hashReviewData({ model: brief.model, messages: request.messages, schema: request.jsonSchema })
      const prior = rows.find((r) => r.signature === signature && r.step === step && r.state === "settled")
      if (prior?.result) return prior.result as LLMResult
      if (rows.some((r) => r.state === "uncertain" || r.state === "reserved")) throw new Error("A previous engine request may have consumed plan usage. Acknowledge it before retrying.")
      if (rows.length >= 120) throw new Error("This review reached its 120 engine-call limit. Partial work is saved.")
      const row: z.infer<typeof Attempt> = { id: randomUUID(), signature, step, state: "reserved" }
      rows.push(row); await persist()
      const abort = new AbortController()
      let checking = false
      const timer = setInterval(() => {
        if (checking) return
        checking = true
        void guard().catch(() => abort.abort()).finally(() => { checking = false })
      }, 500)
      try {
        const result = await provider.complete(model, { ...request, signal: abort.signal })
        row.result = result; row.state = "settled"; await persist()
        await withVaultExclusive(storage, "ai-spend", () => new Meter(storage).record({ skill: "literature-review", runId: row.id, provider: provider.id, model, usage: result.usage }, null))
        await guard()
        return result
      } catch (e) { if (row.state !== "settled") { row.state = "uncertain"; await persist() }; throw e }
      finally { clearInterval(timer) }
    } }
    return (await completeStructured(wrapped, brief.model.model, { messages: [{ role: "user", content: prompt }], maxTokens: tokens, thinking: "enabled", singleAttempt: true }, schema)).value
  })
}
