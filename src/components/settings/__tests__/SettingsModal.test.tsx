// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { useUIStore } from "@/stores/ui-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The hosted cards fetch on mount — stub network so mounting is inert.
vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))

import SettingsModal from "../SettingsModal"

function mount() {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<SettingsModal />))
  return { host, root }
}

describe("SettingsModal", () => {
  it("renders nothing when closed", () => {
    act(() => useUIStore.getState().closeSettingsModal())
    const { host } = mount()
    expect(host.querySelector('[role="dialog"]')).toBeNull()
  })
  it("opens on the requested section and lists all five sections", () => {
    act(() => useUIStore.getState().openSettingsModal("appearance"))
    const { host } = mount()
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    for (const label of ["Connect your AI", "Spend & budget", "Companion", "Appearance", "Trending fields"]) {
      expect(host.textContent).toContain(label)
    }
    expect(host.textContent).toContain("Theme")
  })
  it("closes via Escape", () => {
    act(() => useUIStore.getState().openSettingsModal("ai"))
    mount()
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(useUIStore.getState().settingsModalSection).toBeNull()
  })
})
