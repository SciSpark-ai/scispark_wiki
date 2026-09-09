// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { loadSettingsMock, patchSettingsMock } = vi.hoisted(() => ({
  loadSettingsMock: vi.fn(),
  patchSettingsMock: vi.fn(),
}))

vi.mock("@/lib/llm/settings-client", () => ({
  loadRedactedSettings: loadSettingsMock,
  patchSettings: patchSettingsMock,
}))

import { ConnectAiCard } from "../ConnectAiCard"

function mount(element: React.ReactNode): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(element))
  return { host, root }
}

function enter(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("ConnectAiCard first-run handoff", () => {
  beforeEach(() => {
    loadSettingsMock.mockReset().mockResolvedValue({
      keys: {},
      tierModels: {
        fast: { provider: "anthropic", model: "claude-haiku-4-5" },
        strong: { provider: "anthropic", model: "claude-sonnet-5" },
      },
      dailyBudgetUsd: 5,
      baseUrls: {},
    })
    patchSettingsMock.mockReset().mockResolvedValue({})
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      result: { status: "ok", costUsd: 0.001 },
    }), { status: 200, headers: { "content-type": "application/json" } })))
  })

  it("continues to onboarding only after the saved models pass the connection test", async () => {
    const onConnected = vi.fn()
    const { host, root } = mount(<ConnectAiCard firstRun onConnected={onConnected} />)
    await act(async () => { await Promise.resolve() })

    const openAi = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "OpenAI")
    act(() => openAi?.click())
    const apiKey = host.querySelector('input[type="password"]') as HTMLInputElement
    enter(apiKey, "sk-test-only")

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Connect & continue"))
    await act(async () => save?.click())

    expect(patchSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      keys: { openai: "sk-test-only" },
      tierModels: {
        fast: { provider: "openai", model: "gpt-4o-mini" },
        strong: { provider: "openai", model: "gpt-4o" },
      },
    }))
    expect(onConnected).toHaveBeenCalledWith({ provider: "openai", providerLabel: "OpenAI", model: "gpt-4o" })
    expect(fetch).toHaveBeenCalledWith("/api/settings/test-connection", expect.objectContaining({ method: "POST", body: "{}" }))

    act(() => root.unmount())
    host.remove()
  })
  it("does not label a stored key as a verified connection or reuse another provider's saved-key state", async () => {
    loadSettingsMock.mockResolvedValue({
      keys: { anthropic: { present: true } }, tierModels: {
        fast: { provider: "anthropic", model: "claude-haiku-4-5" },
        strong: { provider: "anthropic", model: "claude-sonnet-5" },
      }, baseUrls: {},
    })
    const { host, root } = mount(<ConnectAiCard firstRun />)
    await act(async () => { await Promise.resolve() })
    expect(host.textContent).toContain("Key saved — test connection")
    expect(host.textContent).not.toContain("Connected —")
    act(() => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "OpenAI")?.click())
    expect(host.querySelector('input[type="password"]')?.getAttribute("placeholder")).toBe("Paste your API key")
    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Connect & continue"))!
    expect(save.disabled).toBe(true)
    act(() => root.unmount()); host.remove()
  })
  it("keeps the user on connection setup when a configured model fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: { status: "error", error: "Analysis model unavailable", costUsd: null } })))
    const onConnected = vi.fn()
    const { host, root } = mount(<ConnectAiCard firstRun onConnected={onConnected} />)
    await act(async () => { await Promise.resolve() })
    enter(host.querySelector('input[type="password"]') as HTMLInputElement, "fixture-key")
    await act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Connect & continue"))?.click())
    expect(onConnected).not.toHaveBeenCalled()
    expect(host.textContent).toContain("Analysis model unavailable")
    expect(host.textContent).not.toContain("Connected —")
    act(() => root.unmount()); host.remove()
  })
})
