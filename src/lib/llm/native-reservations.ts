import { z } from "zod"
import type { VaultStorage } from "../vault/storage"

export const NATIVE_RESERVATIONS_PATH = ".scispark/usage/native-attempts.json"
export const NativeReservationSchema = z.object({
  id: z.string().uuid(), runId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  billingMode: z.enum(["api", "subscription"]).default("api"),
  reservedUsd: z.number().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable(),
  state: z.enum(["reserved", "settled", "acknowledged", "released"]),
}).strict().refine(row => row.billingMode === "subscription" ? row.reservedUsd === null && row.costUsd === null : row.reservedUsd !== null,
  "Native financial dollars must match the billing mode")
export async function readNativeReservations(storage: VaultStorage) {
  const raw = await storage.read(NATIVE_RESERVATIONS_PATH)
  return raw === null ? [] : z.array(NativeReservationSchema).parse(JSON.parse(raw))
}
/** Caller owns ai-spend for each mutation; local dispatch keeps local-engine
 * ownership and acquires ai-spend only for journal/Meter writes. */
export async function writeNativeReservation(storage: VaultStorage, input: z.infer<typeof NativeReservationSchema>) {
  const row = NativeReservationSchema.parse(input), rows = await readNativeReservations(storage)
  const index = rows.findIndex(prior => prior.id === row.id)
  if (index < 0) rows.push(row)
  else {
    const prior = rows[index]
    if (prior.runId !== row.runId || prior.day !== row.day || prior.reservedUsd !== row.reservedUsd || prior.billingMode !== row.billingMode || prior.state === "settled") throw new Error("Native reservation identity conflict")
    rows[index] = row
  }
  await storage.write(NATIVE_RESERVATIONS_PATH, JSON.stringify(rows))
}
