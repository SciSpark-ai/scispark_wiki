// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { TrendingSettings } from "@/lib/trending/settings"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getOpenVaultMock = vi.fn()
const readUserModelMock = vi.fn()
const loadTrendingSettingsRemoteMock = vi.fn()
const saveTrendingSettingsRemoteMock = vi.fn()

vi.mock("@/lib/vault/get-vault", () => ({
  getOpenVault: (...args: unknown[]) => getOpenVaultMock(...args),
}))
vi.mock("@/lib/usermodel/pages", () => ({
  readUserModel: (...args: unknown[]) => readUserModelMock(...args),
}))
vi.mock("@/lib/trending/settings-client", () => ({
  loadTrendingSettingsRemote: (...args: unknown[]) => loadTrendingSettingsRemoteMock(...args),
  saveTrendingSettingsRemote: (...args: unknown[]) => saveTrendingSettingsRemoteMock(...args),
}))

import { TrendingFieldsCard } from "../TrendingFieldsCard"

function settings(overrides: Partial<TrendingSettings> = {}): TrendingSettings {
  return {
    fields: [{ slug: "nlp", label: "NLP" }],
    cadence: "weekly",
    anchors: [
      { id: "machine-learning", label: "Machine Learning" },
      { id: "linguistics", label: "Linguistics" },
    ],
    anchorsOverridden: false,
    ...overrides,
  }
}

async function mount(loaded: TrendingSettings) {
  getOpenVaultMock.mockRejectedValue(new Error("no vault in test"))
  readUserModelMock.mockResolvedValue({ interests: null })
  loadTrendingSettingsRemoteMock.mockResolvedValue(loaded)
  saveTrendingSettingsRemoteMock.mockResolvedValue(loaded)

  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<TrendingFieldsCard />)
    // flush the async load effect
    await Promise.resolve()
    await Promise.resolve()
  })
  return { host, root }
}

describe("TrendingFieldsCard", () => {
  beforeEach(() => {
    getOpenVaultMock.mockReset()
    readUserModelMock.mockReset()
    loadTrendingSettingsRemoteMock.mockReset()
    saveTrendingSettingsRemoteMock.mockReset()
  })

  it("renders the current anchors as chips", async () => {
    const { host } = await mount(settings())
    expect(host.textContent).toContain("Machine Learning")
    expect(host.textContent).toContain("Linguistics")
    expect(host.textContent).toContain("Anchor disciplines")
  })

  it("removing an anchor chip and saving sends anchorsOverridden: true with the remaining anchors", async () => {
    const { host } = await mount(settings())

    const removeButton = Array.from(host.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove Machine Learning",
    )
    expect(removeButton).toBeTruthy()
    await act(async () => {
      removeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const saveButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")
    expect(saveButton).toBeTruthy()
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveTrendingSettingsRemoteMock).toHaveBeenCalledTimes(1)
    const sent = saveTrendingSettingsRemoteMock.mock.calls[0][0] as TrendingSettings
    expect(sent.anchors).toEqual([{ id: "linguistics", label: "Linguistics" }])
    expect(sent.anchorsOverridden).toBe(true)
  })

  it("'Reset to auto' clears anchors and anchorsOverridden on save", async () => {
    const { host } = await mount(settings({ anchorsOverridden: true }))

    const resetButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Reset to auto")
    expect(resetButton).toBeTruthy()
    await act(async () => {
      resetButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const saveButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveTrendingSettingsRemoteMock).toHaveBeenCalledTimes(1)
    const sent = saveTrendingSettingsRemoteMock.mock.calls[0][0] as TrendingSettings
    expect(sent.anchors).toEqual([])
    expect(sent.anchorsOverridden).toBe(false)
  })

  it("saving the interests (lens) editor still sends fields unchanged, preserving anchors", async () => {
    const loaded = settings()
    const { host } = await mount(loaded)

    const saveButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(saveTrendingSettingsRemoteMock).toHaveBeenCalledTimes(1)
    const sent = saveTrendingSettingsRemoteMock.mock.calls[0][0] as TrendingSettings
    expect(sent.fields).toEqual([{ slug: "nlp", label: "NLP" }])
    expect(sent.anchors).toEqual(loaded.anchors)
    expect(sent.anchorsOverridden).toBe(loaded.anchorsOverridden)
  })

  it("relabels the narrow-label editor as the interests lens", async () => {
    const { host } = await mount(settings())
    expect(host.textContent).toContain("Your interests")
    expect(host.textContent.toLowerCase()).toContain("highlight")
  })

  it("states the OpenAlex quota honestly", async () => {
    const { host } = await mount(settings())
    // ~40: one field group_by per label, one recent group_by per anchor, ~20
    // per-candidate prior lookups, one recent total per anchor, and the
    // per-topic/breakout searches. The per-topic weekly series (8 more requests
    // per topic once `group_by=publication_date` started 400ing) is gone.
    expect(host.textContent).toContain("40")
    expect(host.textContent).toContain("1,000")
    expect(host.textContent).toMatch(/free API key/i)
    expect(host.textContent).toContain("100")
  })
})
