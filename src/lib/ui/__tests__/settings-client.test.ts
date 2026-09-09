// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_UI_SETTINGS } from "../settings"
import { applyTheme, loadUiSettingsRemote } from "../settings-client"

describe("loadUiSettingsRemote", () => {
  it("falls back to the default theme when the settings request rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("Failed to parse URL"))

    await expect(loadUiSettingsRemote(fetchFn)).resolves.toEqual(DEFAULT_UI_SETTINGS)
  })

  it("falls back to the default theme when the settings response is malformed", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected end of JSON input")),
    })

    await expect(loadUiSettingsRemote(fetchFn)).resolves.toEqual(DEFAULT_UI_SETTINGS)
  })
})

describe("applyTheme", () => {
  it("uses a light fallback when matchMedia is unavailable", () => {
    document.documentElement.dataset.theme = "dark"

    expect(() => applyTheme("system")).not.toThrow()
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
