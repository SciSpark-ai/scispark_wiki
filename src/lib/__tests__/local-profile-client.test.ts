import { describe, expect, it, vi } from "vitest"
import { createProfileFetch } from "../local-profile-client"

describe("profile-bound browser requests", () => {
  it("binds each tab's requests to the profile it rendered, preserving existing headers", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"))
    const bound = createProfileFetch("ada", transport, "http://localhost:3000", vi.fn())
    await bound("/api/vault/file", { method: "PUT", headers: { "x-vault-text": "1" }, body: "note" })
    const headers = new Headers(transport.mock.calls[0][1]?.headers)
    expect(headers.get("x-scispark-profile")).toBe("ada")
    expect(headers.get("x-vault-text")).toBe("1")
  })

  it("never forwards profile identity to external URLs or static assets", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("ok"))
    const bound = createProfileFetch("ada", transport, "http://localhost:3000", vi.fn())
    await bound("https://example.com/api/papers")
    await bound("/brand/logo.png")
    expect(transport.mock.calls[0][1]).toBeUndefined()
    expect(transport.mock.calls[1][1]).toBeUndefined()
  })

  it("closes stale profile UI on session rejection, not ordinary provider errors", async () => {
    const expired = vi.fn()
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("provider", { status: 401 }))
      .mockResolvedValueOnce(new Response("stale", { status: 409, headers: { "x-scispark-session-expired": "1" } }))
    const bound = createProfileFetch("ada", transport, "http://localhost:3000", expired)
    await bound("/api/skills/chat")
    expect(expired).not.toHaveBeenCalled()
    await bound("/api/vault/file")
    expect(expired).toHaveBeenCalledOnce()
  })
})
