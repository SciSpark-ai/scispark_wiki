import { z } from "zod"
import { createHash } from "node:crypto"
import type { WorkflowContext } from "../workflows/context"
import type { ConnectionConfigurationRef } from "../workflows/contracts"
import { getServerS2Key } from "../server/paper-source-settings"
import { ToolKeySchema, UuidSchema, type ToolKey, type ToolRef, toolKey } from "./contracts"
import { ConnectionBindingSchema, ConnectionRecordSchema, type ConnectionBinding, type ConnectionRecord } from "./import-contract"
import { canonicalJSON, importStorage } from "./store"
const State = z.object({ bindings: z.record(ToolKeySchema, z.array(z.object({ id: UuidSchema, revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict())) }).strict()
export interface CommandConnections { bindings: ConnectionRecord[] }
const hash = (value: unknown) => createHash("sha256").update(canonicalJSON(value)).digest("hex")
export async function bindToolConnection(ctx: WorkflowContext, key: ToolKey, binding: ConnectionBinding): Promise<void> {
  ToolKeySchema.parse(key)
  const parsed = ConnectionBindingSchema.safeParse(binding)
  if (!parsed.success) throw new Error("Invalid non-secret connection binding")
  const storage = await importStorage(ctx)
  await storage.exclusive("connection-bindings", async () => {
    const record = { ...parsed.data, profileId: ctx.profileId, vaultId: ctx.vaultId }
    const revision = hash(record)
    const raw = await storage.read("connections/bindings.json")
    const state = raw ? State.parse(JSON.parse(raw)) : { bindings: {} as z.infer<typeof State>["bindings"] }
    await storage.write(`connections/${record.id}/${revision}.json`, JSON.stringify({...record,revision}))
    state.bindings[key] = [...(state.bindings[key] ?? []).filter(b => b.id !== record.id), { id:record.id,revision }]
    await storage.write("connections/bindings.json", JSON.stringify(State.parse(state)))
  })
}
export async function connectionRefsForTools(ctx: WorkflowContext, tools: ToolRef[]): Promise<ConnectionConfigurationRef[]> {
  if(!tools.length)return []
  const raw = await (await importStorage(ctx)).read("connections/bindings.json")
  const state = raw ? State.parse(JSON.parse(raw)) : {bindings:{}}
  return [...new Map(tools.flatMap(t => state.bindings[toolKey(t)] ?? []).map(r => [r.id,r])).values()]
}
export async function readConnectionRevision(ctx: WorkflowContext, ref: ConnectionConfigurationRef): Promise<ConnectionRecord> {
  UuidSchema.parse(ref.id)
  if (!/^[a-f0-9]{64}$/.test(ref.revision)) throw new Error("Invalid connection revision")
  const storage = await importStorage(ctx), path = `connections/${ref.id}/${ref.revision}.json`
  if (await storage.hasSymlinkTraversal(path)) throw new Error("Connection alias")
  const raw = await storage.read(path)
  if (!raw) throw new Error("Captured connection is unavailable")
  const result = ConnectionRecordSchema.safeParse(JSON.parse(raw))
  if (!result.success) throw new Error("Invalid connection record")
  const {revision,...content} = result.data
  if (revision !== ref.revision || content.id !== ref.id || content.profileId !== ctx.profileId || content.vaultId !== ctx.vaultId || hash(content) !== revision) throw new Error("Connection ownership or revision mismatch")
  return result.data
}
/** Current selection is for new commands only. Persisted runs use readConnectionRevision. */
export async function resolveCommandConnections(ctx: WorkflowContext, connectionIds: string[]): Promise<CommandConnections> {
  const ids = z.array(UuidSchema).max(100).parse(connectionIds)
  const storage = await importStorage(ctx), raw = await storage.read("connections/bindings.json")
  const state = raw ? State.parse(JSON.parse(raw)) : {bindings:{}}
  const refs = Object.values(state.bindings).flat()
  const bindings: ConnectionRecord[] = []
  for (const id of [...new Set(ids)]) {
    const matches = refs.filter(r=>r.id===id)
    if (!matches.length || new Set(matches.map(r=>r.revision)).size !== 1) throw new Error("Connection is not selected or is ambiguous")
    bindings.push(await readConnectionRevision(ctx,matches[0]))
  }
  if (bindings.length && !await getServerS2Key(ctx.storage)) throw new Error("Semantic Scholar credentials need setup")
  return {bindings}
}
