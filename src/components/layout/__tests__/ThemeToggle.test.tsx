// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { applyThemeMock, loadUiSettingsMock, saveUiSettingsMock } = vi.hoisted(() => ({
  applyThemeMock: vi.fn(),
  loadUiSettingsMock: vi.fn(),
  saveUiSettingsMock: vi.fn(),
}))

vi.mock("@/lib/ui/settings-client", () => ({
  loadUiSettingsRemote: loadUiSettingsMock,
  saveUiSettingsRemote: saveUiSettingsMock,
  applyTheme: applyThemeMock,
}))

import { ThemeToggle } from "../ThemeToggle"

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme
    loadUiSettingsMock.mockReset().mockResolvedValue({ theme: "light" })
    saveUiSettingsMock.mockReset().mockResolvedValue(undefined)
    applyThemeMock.mockReset().mockImplementation((mode: string) => {
      if (mode === "dark") document.documentElement.dataset.theme = "dark"
      else delete document.documentElement.dataset.theme
    })
  })

  it("switches the live theme and persists the explicit choice", async () => {
    const { host, root } = mount()
    await act(async () => root.render(<ThemeToggle />))

    const button = host.querySelector("button") as HTMLButtonElement
    expect(button.getAttribute("aria-label")).toBe("Switch to dark mode")

    await act(async () => button.click())

    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(saveUiSettingsMock).toHaveBeenCalledWith({ theme: "dark" })
    expect(button.getAttribute("aria-label")).toBe("Switch to light mode")

    act(() => root.unmount())
    host.remove()
  })
})
