import { z } from "zod"
import { RunModelSchema } from "../workflows/contracts"
import { ToolIntentInputSchema, UuidSchema, ToolRefSchema } from "./contracts"
import type { VaultStorage } from "../vault/storage"
export const IntentDecisionSchema = z.object({ kind: z.enum(["chat", "clarify", "tools"]), toolIds: z.array(z.number().int().nonnegative()).max(100) }).strict()
export const ClassificationRecordSchema = z.object({
  id: UuidSchema, profileId: z.string(), vaultId: z.string(), input: ToolIntentInputSchema,
  candidates: z.array(z.object({ ref: ToolRefSchema, name: z.string(), description: z.string(), capabilities: z.array(z.string()) }).strict()).max(100),
  model: RunModelSchema, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  state: z.enum(["reserved", "dispatching", "known", "unknown"]), reservedUsd: z.number().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable(),
  decision: IntentDecisionSchema.optional(), activeSeconds: z.number().nonnegative(),
}).strict()
export const classificationPath = (id: string) => `.scispark/tools/classifications/${UuidSchema.parse(id)}.json`
export async function classificationRecords(storage: VaultStorage) {
  const rows: z.infer<typeof ClassificationRecordSchema>[] = []
  for (const path of await storage.list(".scispark/tools/classifications/")) {
    const raw = await storage.read(path)
    if (raw === null) throw new Error("Classification record disappeared")
    const row = ClassificationRecordSchema.parse(JSON.parse(raw))
    if (path !== classificationPath(row.id)) throw new Error("Classification record identity mismatch")
    rows.push(row)
  }
  return rows
}
