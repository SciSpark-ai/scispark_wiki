import { z } from "zod"
import { UuidSchema } from "../extensions/contracts"
import { readErrorMessage } from "../http"
import { RunActionInputSchema, RunEventSchema, StartRunInputSchema, ToolRunDtoSchema,
  type RunActionInput, type RunEvent, type StartRunInput, type ToolRunDto } from "./contracts"

async function result<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not access the workflow. Refresh its saved state."))
  return schema.parse((await response.json()).result)
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
export async function watchToolRunRemote(id: string, onEvent: (event: RunEvent) => void | Promise<void>, signal: AbortSignal, after = 0, fetchFn: typeof fetch = fetch): Promise<void> {
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
        if (event.runId !== id || event.seq <= cursor) throw new Error("Workflow event cursor or owner mismatch")
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
      let run: ToolRunDto
      try { run = await getToolRunRemote(id, transport, signal) }
      catch (error) { if (error instanceof TypeError) throw new ObservationTransportError("Workflow snapshot transport interrupted"); throw error }
      if (run.id !== id) throw new Error("Workflow snapshot owner mismatch")
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
