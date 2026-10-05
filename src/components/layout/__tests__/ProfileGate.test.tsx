// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProfileGate } from "../ProfileGate"

vi.mock("@/components/brand/BrandLogo", () => ({ BrandLogo: () => <span>SciSpark</span> }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe("local profile gate", () => {
  it("never mounts research content while logged out", async () => {
    const mounted = vi.fn()
    function PrivatePage() { useEffect(mounted, []); return <p>Private research</p> }
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => Response.json(String(url).endsWith("/session") ? { profile: null } : { profiles: [{ id: "ada", name: "Ada", vaultPath: "/local/ada" }] })))
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ProfileGate><PrivatePage /></ProfileGate>))
      expect(container.textContent).toContain("Choose your profile")
      expect(container.textContent).toContain("Ada")
      expect(container.textContent).not.toContain("Private research")
      expect(mounted).not.toHaveBeenCalled()
    } finally { await act(async () => root.unmount()) }
  })

  it("binds child effects before mounting and clears drafts from the previous profile", async () => {
    sessionStorage.setItem("scispark:active-profile", "ada")
    sessionStorage.setItem("scispark:chat-draft:new", "Ada private draft")
    sessionStorage.setItem("scispark:active-chat", "chat_ada")
    sessionStorage.setItem("review-edit:old", "Ada private review")
    const transport = vi.fn().mockImplementation(async (url) => Response.json(String(url).endsWith("/session") ? { profile: { id: "grace", name: "Grace", vaultPath: "/local/grace" } } : {}))
    vi.stubGlobal("fetch", transport)
    function PrivatePage() { useEffect(() => { void fetch("/api/vault/list") }, []); return <p>Grace research</p> }
    const container = document.createElement("div")
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ProfileGate><PrivatePage /></ProfileGate>))
      expect(container.textContent).toBe("Grace research")
      const call = transport.mock.calls.find(([url]) => url === "/api/vault/list")!
      expect(new Headers(call[1].headers).get("x-scispark-profile")).toBe("grace")
      expect(sessionStorage.getItem("scispark:chat-draft:new")).toBeNull()
      expect(sessionStorage.getItem("scispark:active-chat")).toBeNull()
      expect(sessionStorage.getItem("review-edit:old")).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
