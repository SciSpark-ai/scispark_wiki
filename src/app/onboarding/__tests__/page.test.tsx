// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useUserStore } from "@/stores/user-store"
import { initialRecord } from "@/lib/onboarding/contract"
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { router, load } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, load: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router }))
vi.mock("@/lib/onboarding/client", () => ({ loadOnboarding: load }))
vi.mock("@/components/onboarding/OnboardingFlow", () => ({
  OnboardingFlow: ({ onComplete }: { onComplete: (name: string) => void }) => <button onClick={() => onComplete("Ada")}>Confirm profile</button>,
}))
import OnboardingPage from "../page"
describe("OnboardingPage routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    load.mockResolvedValue({ ...initialRecord(), connected: true, onboarded: false, revision: null })
    useUserStore.setState({ user: null, onboardingComplete: false })
  })
  it("routes an unconnected new user to BYOK without starting AI", async () => {
    load.mockResolvedValue({ ...initialRecord(), connected: false, onboarded: false, revision: null })
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => root.render(<OnboardingPage />))
    expect(router.replace).toHaveBeenCalledWith("/setup")
    expect(host.querySelector("button")).toBeNull()
    act(() => root.unmount())
  })
  it("opens the conversation after connection and starts feed setup only after confirmed completion", async () => {
    const host = document.createElement("div")
    const root = createRoot(host)
    await act(async () => root.render(<OnboardingPage />))
    expect(router.push).not.toHaveBeenCalled()
    await act(async () => host.querySelector("button")!.click())
    expect(router.push).toHaveBeenCalledWith("/setup")
    expect(useUserStore.getState().user?.name).toBe("Ada")
    act(() => root.unmount())
  })
})
