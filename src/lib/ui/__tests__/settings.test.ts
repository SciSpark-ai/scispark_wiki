import { describe, it, expect } from "vitest"
import { normalizeUiSettings, DEFAULT_UI_SETTINGS } from "../settings"

describe("normalizeUiSettings", () => {
  it("defaults for garbage input", () => {
    expect(normalizeUiSettings(undefined)).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings(null)).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings({ theme: "neon" })).toEqual(DEFAULT_UI_SETTINGS)
    expect(normalizeUiSettings("dark")).toEqual(DEFAULT_UI_SETTINGS)
  })
  it("accepts the three valid modes", () => {
    expect(normalizeUiSettings({ theme: "dark" })).toEqual({ theme: "dark" })
    expect(normalizeUiSettings({ theme: "light" })).toEqual({ theme: "light" })
    expect(normalizeUiSettings({ theme: "system" })).toEqual({ theme: "system" })
  })
})
