/**
 * Isomorphic NDJSON stream consumer, split into its own file (M11 Task 5)
 * because Turbopack does not tree-shake unused exports out of a client
 * bundle when the *module* also exports server-only code — `skill-route.ts`
 * imports `getServerVault` (→ `NodeFsVaultStorage` → `node:fs/promises`) at
 * module scope for `jsonSkillRoute`/`ndjsonSkillRoute`, and a client
 * component importing even just `readNdjson` from that module drags the
 * whole `node:fs/promises` chain into the browser bundle, which Turbopack
 * refuses to build ("the chunking context does not support external
 * modules"). This file has zero server-only dependencies — pure
 * `Response`/`ReadableStream`/`TextDecoder` — so browser code (e.g.
 * `src/lib/trending/client.ts`) must import `readNdjson` from HERE, not from
 * `skill-route.ts`. `skill-route.ts` re-exports it for server-side
 * convenience so "the same file" still has all three names for anyone
 * importing from server-only contexts.
 */

interface NdjsonEvent {
  type?: string
  message?: string
  [key: string]: unknown
}

/**
 * Line-buffers across chunk boundaries so a line split across two
 * `reader.read()` chunks, or multiple lines delivered in one chunk, are both
 * handled correctly. Calls `onEvent` for every non-terminal (`progress`)
 * line as it arrives; resolves with the terminal `result` event's payload
 * (with `type` stripped) once the stream ends, or rejects with an `Error`
 * built from the terminal `error` event's `message`. A stream that ends
 * without ever seeing a `result` or `error` event is itself treated as a
 * failure.
 */
export async function readNdjson(res: Response, onEvent: (event: NdjsonEvent) => void): Promise<unknown> {
  if (!res.body) throw new Error("readNdjson: response has no body")
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: unknown
  let hasResult = false
  let errorMessage: string | null = null

  function handleLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    const event = JSON.parse(trimmed) as NdjsonEvent
    if (event.type === "result") {
      const rest: Record<string, unknown> = { ...event }
      delete rest.type
      result = rest
      hasResult = true
    } else if (event.type === "error") {
      errorMessage = event.message ?? "skill error"
    } else {
      onEvent(event)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      buffer += decoder.decode(value, { stream: true })
      let newlineIdx = buffer.indexOf("\n")
      while (newlineIdx >= 0) {
        handleLine(buffer.slice(0, newlineIdx))
        buffer = buffer.slice(newlineIdx + 1)
        newlineIdx = buffer.indexOf("\n")
      }
    }
    if (done) break
  }
  if (buffer.length > 0) handleLine(buffer)

  if (errorMessage != null) throw new Error(errorMessage)
  if (!hasResult) throw new Error("readNdjson: stream ended without a result or error event")
  return result
}
