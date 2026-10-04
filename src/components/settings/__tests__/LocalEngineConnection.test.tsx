// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_ENGINES, type EngineSettings, type LocalEngine } from "@/lib/engines/contracts"
import { LocalEngineConnection } from "../LocalEngineConnection"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { checkEngine, patchSettings } = vi.hoisted(() => ({ checkEngine: vi.fn(), patchSettings: vi.fn() }))
vi.mock("@/lib/engines/client", () => ({ checkLocalEngine: checkEngine }))
vi.mock("@/lib/llm/settings-client", () => ({ patchSettings }))

let host: HTMLDivElement
let root: Root
async function mount(engine: LocalEngine, initial: EngineSettings = DEFAULT_ENGINES) {
  function Harness() {
    const [settings, setSettings] = useState(initial)
    return <LocalEngineConnection engine={engine} settings={settings} onSaved={setSettings} firstRun={false} />
  }
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<Harness />))
}
function select(label: string, value: string) {
  const input = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
  expect(input).not.toBeNull()
  act(() => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })) })
}
function enter(label: string, value: string) {
  const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement
  expect(input).not.toBeNull()
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
function button(name: string) { return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === name)! }

beforeEach(() => {
  checkEngine.mockReset().mockResolvedValue({ engine: "codex", state: "ready", message: "Signed in", models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "custom/model-v3", "custom/model-v4"].map(id => ({ id, label: id })) })
  patchSettings.mockReset().mockResolvedValue({})
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ result: { status: "ok" } })))
})
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.unstubAllGlobals() })

describe("local model selection", () => {
  it("limits Codex to discovered choices, retaining unavailable saved IDs visibly", async () => {
    await mount("codex", { ...DEFAULT_ENGINES, kind: "codex", models: { ...DEFAULT_ENGINES.models, codex: { strong: "unavailable-model", fast: "gpt-5.6-luna" } } })
    expect(host.querySelector('option[value="__custom__"]')).toBeNull()
    expect(host.querySelector('input[aria-label="Codex analysis custom model ID"]')).toBeNull()
    expect(host.textContent).toContain("unavailable-model (unavailable)")
    expect(button("Save models").disabled).toBe(true)
    select("Codex analysis model", "gpt-5.6-sol")
    expect(button("Save models").disabled).toBe(false)
    expect(host.textContent).toContain("Check connection refreshes")
  })

  it("shows a loading choice until Codex discovery completes", async () => {
    checkEngine.mockReturnValue(new Promise(() => {}))
    await mount("codex")
    expect(host.textContent).toContain("Loading available models")
    expect(host.textContent).not.toContain("Custom model")
    expect((host.querySelector('select[aria-label="Codex analysis model"]') as HTMLSelectElement).disabled).toBe(true)
  })
  it.each(["signed-out", "failed"])("stops showing loading when discovery is %s", async (state) => {
    if (state === "failed") checkEngine.mockRejectedValue(new Error("Connection check failed"))
    else checkEngine.mockResolvedValue({ engine: "codex", state, message: "Sign in first" })
    await mount("codex")
    expect(host.textContent).not.toContain("Loading available models")
    expect(host.textContent).toContain("Check connection to load models")
    expect(button("Use Codex").disabled).toBe(true)
    enter("Timeout per request (seconds)", "120")
    expect(host.textContent).not.toContain("Loading available models")
  })
  it("refuses to save or test a model absent from the installed CLI catalog", async () => {
    checkEngine.mockResolvedValue({ engine: "codex", state: "ready", message: "Signed in", models: [{ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" }] })
    await mount("codex", { ...DEFAULT_ENGINES, kind: "codex", models: { ...DEFAULT_ENGINES.models, codex: { strong: "gpt-6-astra", fast: "gpt-5.6-luna" } } })
    await act(async () => button("Save & test models (uses plan)").click())
    expect(patchSettings).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(host.textContent).toContain("not available")
  })
  it("saves both chosen tiers without inference or changing the other engine", async () => {
    await mount("codex", { ...DEFAULT_ENGINES, kind: "codex" })
    select("Codex analysis model", "gpt-5.6-terra")
    select("Codex quick model", "gpt-5.6-luna")
    expect(host.textContent).toContain("Unsaved changes")
    expect(patchSettings).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    await act(async () => button("Save models").click())
    expect(patchSettings).toHaveBeenCalledWith({ engines: {
      ...DEFAULT_ENGINES, kind: "codex", models: { ...DEFAULT_ENGINES.models, codex: { strong: "gpt-5.6-terra", fast: "gpt-5.6-luna" } },
    } })
    expect(fetch).not.toHaveBeenCalled()
    expect(host.textContent).toContain("Saved models: gpt-5.6-terra (analysis) · gpt-5.6-luna (quick steps)")
    expect(host.textContent).not.toContain("Unsaved changes")
    select("Codex analysis model", "gpt-5.6-sol")
    expect(host.textContent).not.toContain("No model call was made.")
  })

  it("offers Claude aliases and uses the explicit test action for inference", async () => {
    await mount("claude-code")
    select("Claude Code analysis model", "opus")
    select("Claude Code quick model", "sonnet")
    await act(async () => button("Save & test models (uses plan)").click())
    expect(patchSettings).toHaveBeenCalledWith(expect.objectContaining({ engines: expect.objectContaining({
      kind: "claude-code", models: { ...DEFAULT_ENGINES.models, "claude-code": { strong: "opus", fast: "sonnet" } },
    }) }))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith("/api/settings/test-connection", expect.objectContaining({ method: "POST" }))
    expect(host.textContent).toContain("Both model tiers passed")
  })

  it("preserves saved custom IDs and supports editing, trimming, and returning to a preset", async () => {
    await mount("claude-code", { ...DEFAULT_ENGINES, kind: "claude-code", models: { ...DEFAULT_ENGINES.models, "claude-code": { strong: "custom/model-v2", fast: "haiku" } } })
    expect((host.querySelector('input[aria-label="Claude Code analysis custom model ID"]') as HTMLInputElement).value).toBe("custom/model-v2")
    enter("Claude Code analysis custom model ID", "  custom/model-v3  ")
    await act(async () => button("Save models").click())
    expect(patchSettings.mock.calls[0][0].engines.models["claude-code"].strong).toBe("custom/model-v3")
    select("Claude Code analysis model", "sonnet")
    expect(host.querySelector('input[aria-label="Claude Code analysis custom model ID"]')).toBeNull()
    select("Claude Code analysis model", "__custom__")
    enter("Claude Code analysis custom model ID", "custom/model-v4")
    await act(async () => button("Save models").click())
    expect(patchSettings.mock.calls[1][0].engines.models["claude-code"].strong).toBe("custom/model-v4")
  })

  it("prevents invalid or blank custom IDs and invalid timeouts from being saved or tested", async () => {
    await mount("claude-code", { ...DEFAULT_ENGINES, kind: "claude-code" })
    select("Claude Code analysis model", "__custom__")
    for (const invalid of ["", "bad model", "-option", "a".repeat(151)]) {
      enter("Claude Code analysis custom model ID", invalid)
      expect(button("Save models").disabled).toBe(true)
      expect(button("Save & test models (uses plan)").disabled).toBe(true)
    }
    enter("Claude Code analysis custom model ID", "sonnet")
    expect(button("Save models").disabled).toBe(false)
    enter("Timeout per request (seconds)", "0")
    expect(button("Save models").disabled).toBe(true)
    expect(patchSettings).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps saved models unchanged and edits available when saving fails", async () => {
    patchSettings.mockRejectedValueOnce(new Error("Could not save settings"))
    await mount("codex", { ...DEFAULT_ENGINES, kind: "codex" })
    select("Codex analysis model", "gpt-5.6-terra")
    await act(async () => button("Save models").click())
    expect(host.textContent).toContain("Could not save settings")
    expect(host.textContent).toContain("Unsaved changes")
    expect(host.textContent).toContain("Saved models: gpt-5.6-sol (analysis) · gpt-5.6-luna (quick steps)")
    expect(fetch).not.toHaveBeenCalled()
  })
})
