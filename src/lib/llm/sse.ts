import { LLMTransientError } from "./types"

/** Incrementally decode SSE, including split UTF-8, CRLF and multi-line data. */
export async function* readSseData(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new LLMTransientError("Provider returned no stream")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let data: string[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let end: number
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "")
        buffer = buffer.slice(end + 1)
        if (line === "") {
          if (data.length) yield data.join("\n")
          data = []
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""))
        }
      }
      if (done) break
    }
    if (buffer.trim() || data.length) throw new LLMTransientError("Provider stream ended mid-event")
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
