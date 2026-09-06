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

  it("continues to automatic feed setup only after the saved key passes its connection test", async () => {
    const onConnected = vi.fn()
    const { host, root } = mount(<ConnectAiCard firstRun onConnected={onConnected} />)
    await act(async () => { await Promise.resolve() })

    const openAi = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "OpenAI")
    act(() => openAi?.click())
    const apiKey = host.querySelector('input[type="password"]') as HTMLInputElement
    enter(apiKey, "sk-test-only")

    const save = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save, test & build my feed"))
    await act(async () => save?.click())

    expect(patchSettingsMock).toHaveBeenCalledWith(expect.objectContaining({
      keys: { openai: "sk-test-only" },
      tierModels: {
        fast: { provider: "openai", model: "gpt-4o-mini" },
        strong: { provider: "openai", model: "gpt-4o" },
      },
    }))
    expect(onConnected).toHaveBeenCalledWith({ provider: "openai", providerLabel: "OpenAI", model: "gpt-4o" })

    act(() => root.unmount())
    host.remove()
  })
})
