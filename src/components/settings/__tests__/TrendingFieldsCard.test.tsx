// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { TrendingSettings } from "@/lib/trending/settings"
import { canonicalAnchor } from "@/lib/trending/openalex-fields"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const loadMock = vi.fn(), saveMock = vi.fn(), suggestMock = vi.fn()
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/usermodel/pages", () => ({ readUserModel: async () => ({ interests: null }) }))
vi.mock("@/lib/trending/settings-client", () => ({
  loadTrendingSettingsRemote: (...args: unknown[]) => loadMock(...args),
  saveTrendingSettingsRemote: (...args: unknown[]) => saveMock(...args),
  suggestTrendingFieldsRemote: (...args: unknown[]) => suggestMock(...args),
}))
import { TrendingFieldsCard } from "../TrendingFieldsCard"
const CS = canonicalAnchor("17")!, NEURO = canonicalAnchor("28")!, PSYCH = canonicalAnchor("32")!
function settings(overrides: Partial<TrendingSettings> = {}): TrendingSettings {
  return { fields: [{ slug: "nlp", label: "NLP" }], cadence: "weekly", anchors: [CS], anchorsOverridden: false, ...overrides }
}
let root: Root, host: HTMLDivElement
async function mount(loaded = settings()) {
  loadMock.mockResolvedValueOnce(loaded)
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
  await act(async () => { root.render(<TrendingFieldsCard />) })
}
function button(name: string) {
  const result = Array.from(host.querySelectorAll("button")).find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name)
  if (!result) throw new Error("Missing button: " + name)
  return result
}
async function click(name: string) { await act(async () => { button(name).click() }) }
function field(name: string) {
  const label = Array.from(host.querySelectorAll("label")).find((label) => label.textContent === name)
  if (!label) throw new Error("Missing field: " + name)
  return label.querySelector<HTMLInputElement>("input")!
}
async function toggle(name: string) { await act(async () => { field(name).click() }) }
async function fill(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
describe("TrendingFieldsCard", () => {
  beforeEach(() => {
    loadMock.mockReset(); saveMock.mockReset().mockImplementation(async (next) => next)
    suggestMock.mockReset().mockResolvedValue([NEURO])
  })
  afterEach(async () => { if (root) await act(async () => { root.unmount() }); host?.remove() })

  it("lists all 26 official fields separately from free-text interests", async () => {
    await mount()
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(26)
    expect(field("Computer Science").checked).toBe(true)
    expect(host.textContent).toContain("General fields")
    expect(host.querySelector('[aria-label="Interest 1"]')).not.toBeNull()
  })
  it("search filters fields, never creates or saves a custom label on Enter", async () => {
    await mount()
    await fill('input[type="search"]', "neuro")
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    await toggle("Neuroscience")
    expect(saveMock).not.toHaveBeenCalled()
    await fill('input[type="search"]', "speech in noise")
    expect(host.textContent).toContain("No matching field.")
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    await act(async () => { host.querySelector('input[type="search"]')!.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(saveMock).not.toHaveBeenCalled()
    await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([CS, NEURO])
  })
  it("saves multiple official IDs, caps selection at three, and allows deselection", async () => {
    await mount()
    await toggle("Neuroscience"); await toggle("Psychology")
    expect(field("Medicine").disabled).toBe(true)
    expect(field("Psychology").disabled).toBe(false)
    await toggle("Psychology")
    expect(field("Medicine").disabled).toBe(false)
    await toggle("Psychology"); await click("Save")
    expect(saveMock).toHaveBeenCalledWith(settings({ anchors: [CS, NEURO, PSYCH], anchorsOverridden: true }))
  })
  it("requires a replacement when removing the final field", async () => {
    await mount()
    await click("Remove Computer Science")
    expect(button("Save").disabled).toBe(true)
    await toggle("Neuroscience")
    await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([NEURO])
  })
  it("keeps legacy custom topics visible for explicit replacement", async () => {
    await mount(settings({ anchors: [{ id: "custom:hearing", label: "Hearing science" }], anchorsOverridden: true }))
    expect(host.textContent).toContain("Hearing science")
    expect(host.textContent).toContain("Choose an official field instead.")
    expect(button("Save").disabled).toBe(true)
    expect(field("Neuroscience").checked).toBe(false)
    await click("Remove Hearing science"); await toggle("Neuroscience"); await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([NEURO])
  })
  it("suggestions are a preview and require an explicit add and Save", async () => {
    await mount()
    expect(suggestMock).not.toHaveBeenCalled()
    await click("Suggest from my interests")
    expect(suggestMock).toHaveBeenCalledWith(["NLP"])
    expect(field("Neuroscience").checked).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
    await click("Add Neuroscience")
    expect(field("Neuroscience").checked).toBe(true)
    expect(saveMock).not.toHaveBeenCalled()
    await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([CS, NEURO])
  })
  it("suggestion failure leaves manual selection usable", async () => {
    await mount()
    suggestMock.mockRejectedValueOnce(new Error("Source unavailable"))
    await click("Suggest from my interests")
    expect(host.textContent).toContain("Source unavailable")
    await toggle("Neuroscience"); await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([CS, NEURO])
  })
  it("preserves existing fields when only interests or cadence change", async () => {
    await mount()
    await fill('[aria-label="Interest 1"]', "Hearing"); await click("Daily"); await click("Save")
    expect(saveMock).toHaveBeenCalledWith(settings({ fields: [{ slug: "hearing", label: "Hearing" }], cadence: "daily" }))
  })
  it("keeps selections after failed save", async () => {
    await mount(); saveMock.mockRejectedValueOnce(new Error("Temporary outage"))
    await toggle("Neuroscience"); await click("Save")
    expect(field("Neuroscience").checked).toBe(true)
    expect(host.textContent).toContain("Temporary outage")
    await click("Save"); expect(saveMock).toHaveBeenCalledTimes(2)
  })
  it("cannot overwrite settings after a failed load and supports retry", async () => {
    loadMock.mockRejectedValueOnce(new Error("offline")); await mount()
    expect(button("Save").disabled).toBe(true)
    await click("Retry"); expect(button("Save").disabled).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })
  it("prevents duplicate saves", async () => {
    await mount()
    let finish!: (value: TrendingSettings) => void
    saveMock.mockImplementationOnce(() => new Promise<TrendingSettings>((resolve) => { finish = resolve }))
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(saveMock).toHaveBeenCalledTimes(1)
    await act(async () => { finish(settings()) })
  })
  it("reveals only a chosen field's subfields and preserves the optional subset on Save", async () => {
    await mount(settings({ anchors: [NEURO] }))
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(26)
    expect(host.textContent).not.toContain("Cognitive Neuroscience")
    const details = host.querySelector("details")!
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event("toggle"))
    })
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(34)
    expect(host.textContent).not.toContain("Health Informatics")
    await toggle("Cognitive Neuroscience"); await toggle("Sensory Systems")
    await click("Save")
    const expected = { ...NEURO, subfieldIds: ["https://openalex.org/subfields/2805", "https://openalex.org/subfields/2809"] }
    expect(saveMock.mock.calls[0][0].anchors).toEqual([expected])
    await click("Suggest from my interests")
    expect(button("Add Neuroscience").disabled).toBe(true)
    await click("Include entire field"); await click("Save")
    expect(saveMock.mock.calls[1][0].anchors).toEqual([{ ...NEURO, subfieldIds: [] }])
    await toggle("Cognitive Neuroscience")
    await click("Remove Neuroscience"); await toggle("Neuroscience"); await click("Save")
    expect(saveMock.mock.calls[2][0].anchors).toEqual([NEURO])
  })
  it("loads a saved subset collapsed and keeps it during other settings edits", async () => {
    const anchor = { ...NEURO, subfieldIds: ["https://openalex.org/subfields/2805"] }
    await mount(settings({ anchors: [anchor], anchorsOverridden: true }))
    expect(host.querySelector("details")!.open).toBe(false)
    expect(host.textContent).toContain("Cognitive Neuroscience")
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(26)
    await click("Daily"); await click("Save")
    expect(saveMock.mock.calls[0][0].anchors).toEqual([anchor])
  })
})
