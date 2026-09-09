// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { initialRecord, type OnboardingState } from "@/lib/onboarding/contract"
import { OnboardingFlow } from "../OnboardingFlow"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const { sendMock, loadMock } = vi.hoisted(() => ({ sendMock: vi.fn(), loadMock: vi.fn() }))
vi.mock("@/lib/onboarding/client", () => ({ sendOnboarding: sendMock, loadOnboarding: loadMock }))
function initial(): OnboardingState { return { ...initialRecord(), revision: null, connected: true, onboarded: false } }
function mount(state = initial()) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const onComplete = vi.fn()
  act(() => root.render(<OnboardingFlow initial={state} onComplete={onComplete} />))
  return { host, root, onComplete, cleanup: () => { act(() => root.unmount()); host.remove() } }
}
function compose(host: HTMLElement, value: string) {
  const field = host.querySelector('[aria-label="Your reply to Sparky"]') as HTMLTextAreaElement
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })) })
}
function enter(host: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options })
  act(() => host.querySelector('[aria-label="Your reply to Sparky"]')!.dispatchEvent(event))
  return event
}
describe("AI onboarding conversation", () => {
  beforeEach(() => {
    sendMock.mockReset().mockImplementation(async (input) => ({ state: { ...initial(), revision: "a".repeat(64), question: "research", messages: [...initial().messages, { role: "user", content: input.message }, { role: "assistant", content: "Which research do you follow?" }] }, warnings: [] }))
    loadMock.mockReset().mockResolvedValue(initial())
  })
  it("asks name first without making a paid call on mount", () => {
    const { host, cleanup } = mount()
    expect(host.textContent).toContain("What should I call you?")
    expect(host.querySelector("textarea")?.placeholder).toBe("Your name")
    expect(sendMock).not.toHaveBeenCalled()
    expect(host.querySelector("dialog")).toBeNull()
    cleanup()
  })
  it("sends Enter, preserves Shift+Enter and IME, and prevents duplicate sends", async () => {
    const { host, cleanup } = mount()
    enter(host)
    expect(sendMock).not.toHaveBeenCalled()
    compose(host, "Ada")
    expect(enter(host, { shiftKey: true }).defaultPrevented).toBe(false)
    expect(enter(host, { isComposing: true }).defaultPrevented).toBe(false)
    expect(enter(host, { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(sendMock).not.toHaveBeenCalled()
    await act(async () => { enter(host); enter(host) })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toEqual({ action: "message", revision: null, message: "Ada" })
    cleanup()
  })
  it("shows real streamed text before completion and uses inverse colors for user answers", async () => {
    let finish!: (result: unknown) => void
    let preview!: (text: string) => void
    sendMock.mockImplementation((_input, onText) => { preview = onText; return new Promise((resolve) => { finish = resolve }) })
    const { host, onComplete, cleanup } = mount()
    const scroll = host.querySelector('[aria-label="Onboarding conversation"]') as HTMLDivElement
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 900 })
    compose(host, "Ada, postdoc in auditory neuroscience")
    enter(host)
    act(() => preview("What question"))
    expect(host.textContent).toContain("What question")
    expect(host.textContent).toContain("Ada, postdoc")
    const answer = [...host.querySelectorAll("p")].find((node) => node.textContent === "Ada, postdoc in auditory neuroscience")
    expect(answer?.className).toContain("bg-secondary-dark")
    expect(answer?.className).toContain("text-page-bg")
    expect(scroll.scrollTop).toBe(900)
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => finish({ state: initial(), warnings: [] }))
    cleanup()
  })
  it("accepts custom diversity replies instead of forcing a suggestion", async () => {
    const state = { ...initial(), question: "diversity" as const }
    const { host, cleanup } = mount(state)
    expect(host.textContent).toContain("A balanced mix")
    const answer = "Mostly auditory work, but show computational methods from nearby fields; no animal studies."
    compose(host, answer)
    await act(async () => enter(host))
    expect(sendMock.mock.calls[0][0].message).toBe(answer)
    cleanup()
  })
  it("lets the user edit all extracted answers and confirms explicitly", async () => {
    const state: OnboardingState = { ...initial(), question: "review", draft: { name: "Ada", role: "Postdoc", fields: "Hearing", topics: "EEG", feedPrefs: "Methods", diversity: "focused", diversityNote: "Stay close to hearing research", learnFromFeedback: false } }
    const { host, onComplete, cleanup } = mount(state)
    expect(sendMock).not.toHaveBeenCalled()
    const form = host.querySelector("form")!
    expect(form.querySelectorAll("textarea")).toHaveLength(5)
    const name = form.querySelector("textarea")!
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(name, "Ada Lovelace"); name.dispatchEvent(new Event("input", { bubbles: true })) })
    sendMock.mockResolvedValueOnce({ state, profile: { name: "Ada Lovelace" }, warnings: [] })
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(sendMock.mock.calls[0][0]).toMatchObject({ action: "confirm", answers: { name: "Ada Lovelace", recommendations: { learnFromFeedback: false } } })
    expect(onComplete).toHaveBeenCalledWith("Ada Lovelace")
    cleanup()
  })
  it("recovers a saved unanswered turn after failure and retries without a new message", async () => {
    sendMock.mockRejectedValueOnce(new Error("Provider timed out"))
    const saved: OnboardingState = { ...initial(), pending: true, revision: "b".repeat(64), messages: [...initial().messages, { role: "user", content: "Ada" }] }
    loadMock.mockResolvedValue(saved)
    const { host, cleanup } = mount()
    compose(host, "Ada")
    await act(async () => enter(host))
    expect(host.textContent).toContain("Provider timed out")
    const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry Sparky’s response")!
    await act(async () => retry.click())
    expect(sendMock.mock.calls[1][0]).toEqual({ action: "retry", revision: saved.revision })
    cleanup()
  })
})
