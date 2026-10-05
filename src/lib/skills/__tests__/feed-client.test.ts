import { describe, expect, it, vi } from "vitest"
import { resumeFeedRefresh } from "../feed-client"

describe("feed refresh reconnection transport", () => {
  it("observes with GET, forwards cancellation, and leaves an idle server idle", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"type":"result","payload":null}\n'))
    const controller = new AbortController()
    expect(await resumeFeedRefresh(undefined, transport, controller.signal)).toBeNull()
    expect(transport).toHaveBeenCalledExactlyOnceWith("/api/skills/feed/refresh", { method: "GET", cache: "no-store", signal: controller.signal })
  })
  it("restores the server start time and delivers the existing result", async () => {
    const progress = vi.fn()
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      { type: "progress", stage: "rank", startedAt: 1234 },
      { type: "result", payload: { generatedAt: "fixture-result" } },
    ].map((event) => JSON.stringify(event)).join("\n")))
    expect(await resumeFeedRefresh(progress, transport)).toEqual({ generatedAt: "fixture-result" })
    expect(progress).toHaveBeenCalledWith("rank", 1234)
  })
  it("does not retry or start new work when the read-only connection fails", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 }))
    await expect(resumeFeedRefresh(undefined, transport)).rejects.toThrow("Could not reconnect")
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
