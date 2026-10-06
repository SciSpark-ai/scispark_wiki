import { describe, expect, it, vi } from "vitest"
import { watchToolRunRemote } from "../client"
import { ToolRunDtoSchema } from "../contracts"
import { workflowFixture } from "./fixtures"
describe("run observer transport boundaries", () => {
  it.each([null, {}, { result: null }])("fails malformed snapshot %j instead of retrying forever", async body => {
    const run = workflowFixture().run, fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("events") ? new Response("") : Response.json(body))
    await expect(watchToolRunRemote(run.id, () => {}, new AbortController().signal, 0, fetcher)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it("ignores duplicate cursors and drains the terminal public text exactly once", async () => {
    const run = ToolRunDtoSchema.strip().parse({ ...workflowFixture().run, status: "completed", eventCursor: 2 })
    const events = [{ runId: run.id, seq: 1, type: "text", text: "Partial" }, { runId: run.id, seq: 1, type: "text", text: "Partial" }, { runId: run.id, seq: 2, type: "text", text: "Final" }]
    const seen: string[] = [], fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("events") ? new Response(events.map(e => JSON.stringify(e)).join("\n")) : Response.json({ result: run }))
    await watchToolRunRemote(run.id, event => { if (event.type === "text") seen.push(event.text) }, new AbortController().signal, 0, fetcher)
    expect(seen).toEqual(["Partial", "Final"])
  })
})
