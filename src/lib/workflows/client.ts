import { z } from "zod"
import { UuidSchema } from "../extensions/contracts"
import { readErrorMessage } from "../http"
import { RunActionInputSchema, RunEventSchema, StartRunInputSchema, ToolRunDtoSchema,
  type RunActionInput, type RunEvent, type StartRunInput, type ToolRunDto } from "./contracts"

const RecoveryConflictSchema = z.object({ code: z.literal("changeset_recovery_conflict"), runId: UuidSchema, changesetId: UuidSchema, conflicts: z.array(z.string()), error: z.string() }).strict()
export class WorkflowRecoveryConflict extends Error {
  constructor(readonly details: z.infer<typeof RecoveryConflictSchema>) { super(`${details.error} Affected pages: ${details.conflicts.join(", ")}`) }
}
async function result<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    const conflict = RecoveryConflictSchema.safeParse(await response.clone().json().catch(() => null))
    if (conflict.success) throw new WorkflowRecoveryConflict(conflict.data)
    throw new Error(await readErrorMessage(response, "Could not access the workflow. Refresh its saved state."))
  }
  return z.object({ result: schema }).parse(await response.json()).result
}
const runPath = (id: string) => `/api/tools/runs/${UuidSchema.parse(id)}`
export async function startToolRemote(input: StartRunInput, fetchFn: typeof fetch = fetch): Promise<ToolRunDto> {
  return result(await fetchFn("/api/tools/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(StartRunInputSchema.parse(input)) }), ToolRunDtoSchema)
}
export async function getToolRunRemote(id: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<ToolRunDto> {
  return result(await fetchFn(runPath(id), { cache: "no-store", signal }), ToolRunDtoSchema)
}
export async function listToolRunsRemote(fetchFn: typeof fetch = fetch): Promise<ToolRunDto[]> {
  return result(await fetchFn("/api/tools/runs", { cache: "no-store" }), z.array(ToolRunDtoSchema))
}
export async function actOnToolRunRemote(id: string, input: RunActionInput, fetchFn: typeof fetch = fetch): Promise<ToolRunDto> {
  return result(await fetchFn(`${runPath(id)}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(RunActionInputSchema.parse(input)) }), ToolRunDtoSchema)
}
class ObservationTransportError extends Error {}

function delay(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve() }
    const timer = setTimeout(finish, 750)
    signal.addEventListener("abort", finish, { once: true }); if (signal.aborted) finish()
  })
}
/** Consumes finite replay batches, then polls with the last delivered cursor.
 * Aborting detaches only this observer; cancel/resume are explicit actions. The
 * skill readNdjson result/progress envelope is intentionally not a RunEvent. */
export async function watchToolRunRemote(id: string, onEvent: (event: RunEvent) => void | Promise<void>, signal: AbortSignal, after = 0, fetchFn: typeof fetch = fetch, onSnapshot?: (run: ToolRunDto) => void): Promise<void> {
  const path = runPath(id)
  let cursor = z.number().int().nonnegative().safe().parse(after)
  const transport: typeof fetch = async (url, init) => {
    try { return await fetchFn(url, init) }
    catch (error) { if (signal.aborted) throw error; throw new ObservationTransportError("Workflow transport interrupted") }
  }
  while (!signal.aborted) {
    try {
      const response = await transport(`${path}/events?after=${cursor}`, { cache: "no-store", signal })
      if (!response.ok) throw new Error(await readErrorMessage(response, "Could not observe the workflow."))
      if (!response.body) throw new Error("Workflow observation has no body")
      const reader = response.body.getReader(), decoder = new TextDecoder()
      const detach = () => { void reader.cancel().catch(() => {}) }
      signal.addEventListener("abort", detach, { once: true })
      let buffer = ""
      const deliver = async (line: string) => {
        if (!line.trim() || signal.aborted) return
        const event = RunEventSchema.parse(JSON.parse(line))
        if (event.runId !== id) throw new Error("Workflow event owner mismatch")
        if (event.seq <= cursor) return // Replay batches may overlap; observers deliver each durable cursor once.
        await onEvent(event); cursor = event.seq
      }
      try {
        while (!signal.aborted) {
          let chunk: ReadableStreamReadResult<Uint8Array>
          try { chunk = await reader.read() }
          catch (error) { if (signal.aborted) throw error; throw new ObservationTransportError("Workflow stream interrupted") }
          const { done, value } = chunk
          buffer += decoder.decode(value, { stream: !done })
          let newline = buffer.indexOf("\n")
          while (newline >= 0 && !signal.aborted) { await deliver(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); newline = buffer.indexOf("\n") }
          if (done) {
            if (buffer.trim()) {
              try { JSON.parse(buffer) }
              catch { throw new ObservationTransportError("Incomplete workflow event; replay from delivered cursor") }
              await deliver(buffer)
            }
            break
          }
        }
      } finally { signal.removeEventListener("abort", detach); await reader.cancel().catch(() => {}); reader.releaseLock() }
      if (signal.aborted) return
      const run = await getToolRunRemote(id, transport, signal)
      if (run.id !== id) throw new Error("Workflow snapshot owner mismatch")
      onSnapshot?.(run)
      // A terminal transition can land between event replay and snapshot. Drain
      // that durable cursor before stopping, including the terminal text flush.
      if (["completed", "failed", "cancelled"].includes(run.status) && cursor >= run.eventCursor) return
      await delay(signal)
    } catch (error) {
      if (signal.aborted) return
      if (!(error instanceof ObservationTransportError)) throw error
      await delay(signal)
    }
  }
}

export async function saveToolRunRemote(id: string, artifactIds: string[], operationId: string, fetchFn: typeof fetch = fetch) {
  const { SaveRunInputSchema } = await import("./contracts")
  return result(await fetchFn(`${runPath(id)}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(SaveRunInputSchema.parse({ artifactIds, operationId })) }), z.object({ changesetId: UuidSchema }).strict())
}
export async function getToolArtifactRemote(runId: string, artifactId: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal) {
  const response = await fetchFn(`${runPath(runId)}/artifacts/${UuidSchema.parse(artifactId)}`, { cache: "no-store", signal })
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not read the saved artifact."))
  return response
}
