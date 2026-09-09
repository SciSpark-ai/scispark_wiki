// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useUserStore } from "@/stores/user-store"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { pushMock, replaceMock, routerMock, getVaultMock, isOnboardedMock, createProfileMock } = vi.hoisted(() => {
  const push = vi.fn()
  const replace = vi.fn()
  return {
    pushMock: push,
    replaceMock: replace,
    routerMock: { push, replace },
    getVaultMock: vi.fn(),
    isOnboardedMock: vi.fn(),
    createProfileMock: vi.fn(),
  }
})

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: getVaultMock }))
vi.mock("@/lib/usermodel/pages", () => ({ isOnboarded: isOnboardedMock }))
vi.mock("@/lib/usermodel/profile-client", () => ({ createUserProfileRemote: createProfileMock }))
vi.mock("@/components/onboarding/OnboardingFlow", () => ({
  OnboardingFlow: ({ onSubmit }: { onSubmit: (answers: Record<string, string>) => void }) => (
    <button type="button" onClick={() => onSubmit({
      name: "Ada",
      role: "Research fellow",
      fields: "Neuroscience",
      topics: "Auditory attention",
      feedPrefs: "Methods papers",
    })}>
      Finish profile
    </button>
  ),
}))

import OnboardingPage from "../page"

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    pushMock.mockReset()
    replaceMock.mockReset()
    getVaultMock.mockReset().mockResolvedValue({})
    isOnboardedMock.mockReset().mockResolvedValue(false)
    createProfileMock.mockReset().mockResolvedValue({})
    useUserStore.setState({ user: null, onboardingComplete: false })
  })

  it("sends a completed profile to BYOK setup instead of an empty home page", async () => {
    const { host, root } = mount()
    act(() => root.render(<OnboardingPage />))
    await act(async () => { await Promise.resolve() })

    const finish = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Finish profile")
    await act(async () => finish?.click())

    expect(createProfileMock).toHaveBeenCalled()
    expect(pushMock).toHaveBeenCalledWith("/setup")
    expect(useUserStore.getState().user?.name).toBe("Ada")

    act(() => root.unmount())
    host.remove()
  })
})
