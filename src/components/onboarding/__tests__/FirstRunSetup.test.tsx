// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { replaceMock, getVaultMock, isOnboardedMock, loadFeedMock, loadSettingsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  getVaultMock: vi.fn(),
  isOnboardedMock: vi.fn(),
  loadFeedMock: vi.fn(),
  loadSettingsMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: getVaultMock }))
vi.mock("@/lib/usermodel/pages", () => ({ isOnboarded: isOnboardedMock }))
vi.mock("@/lib/skills/feed-cache", () => ({ loadFeed: loadFeedMock }))
vi.mock("@/lib/llm/settings-client", () => ({ loadRedactedSettings: loadSettingsMock }))
vi.mock("@/components/settings/ConnectAiCard", () => ({
  ConnectAiCard: ({ onConnected }: { onConnected: () => void }) => (
    <button type="button" onClick={onConnected}>Complete AI connection</button>
  ),
}))
vi.mock("@/components/feed/FeedRefreshBar", () => ({
  FeedRefreshBar: ({ autoStart, onComplete }: { autoStart: boolean; onComplete: (feed: unknown) => void }) => (
    <button type="button" data-auto-start={String(autoStart)} onClick={() => onComplete({ items: [{}] })}>
      Finish initialization
    </button>
  ),
}))

import { FirstRunSetup } from "../FirstRunSetup"

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("FirstRunSetup", () => {
  beforeEach(() => {
    replaceMock.mockReset()
    getVaultMock.mockReset().mockResolvedValue({})
    isOnboardedMock.mockReset().mockResolvedValue(true)
    loadFeedMock.mockReset().mockResolvedValue(null)
    loadSettingsMock.mockReset().mockResolvedValue({
      keys: {},
      tierModels: { strong: { provider: "openai", model: "gpt-4o" } },
    })
  })

  it("moves from BYOK setup into automatic feed initialization and a clear ready state", async () => {
    const { host, root } = mount()
    await act(async () => root.render(<FirstRunSetup />))

    expect(host.textContent).toContain("Give Sparky a way to think with you")
    expect(host.textContent).toContain("Complete AI connection")

    const connect = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Complete AI connection")
    act(() => connect?.click())
    const initialize = host.querySelector('[data-auto-start="true"]') as HTMLButtonElement
    expect(initialize).not.toBeNull()

    act(() => initialize.click())
    expect(host.textContent).toContain("Your research radar is ready")
    expect(host.textContent).toContain("Sparky found 1 paper")

    act(() => root.unmount())
    host.remove()
  })
})
