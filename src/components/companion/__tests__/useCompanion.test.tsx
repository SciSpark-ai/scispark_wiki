// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useCompanion } from "../useCompanion"
import { useCompanionStore } from "@/stores/companion-store"
import { useUIStore } from "@/stores/ui-store"
import type { CompanionUtterance } from "@/lib/companion/run"

const mocked = vi.hoisted(() => ({ route: "/wiki", remote: vi.fn() }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock("next/navigation", () => ({ usePathname: () => mocked.route }))
vi.mock("@/lib/companion/client", () => ({ companionUtteranceRemote: mocked.remote }))
const reply: CompanionUtterance = { trigger: "review-pending", text: "A duplicate needs review.",
  action: { label: "Review inbox", href: "/wiki/inbox" }, costUsd: 0, fromTemplate: false }
let resolve: (value: CompanionUtterance | null) => void
let draft: (value: CompanionUtterance) => void
let signal: AbortSignal
let root: Root
function Harness() { useCompanion(); return null }
function mount() {
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  const rerender = () => act(() => root.render(<Harness />))
  rerender()
  return { rerender }
}
beforeEach(() => {
  mocked.route = "/wiki"
  mocked.remote.mockReset().mockImplementation((_input, _fetch, onText, abortSignal) => {
    draft = onText
    signal = abortSignal
    return new Promise<CompanionUtterance | null>((done) => { resolve = done })
  })
  useCompanionStore.getState().dismiss()
  useCompanionStore.setState({ feedbackQuestions: [], sessionShownCount: 0, lastShownTs: {} })
  useUIStore.setState({ settingsModalSection: null })
})
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

it.each(["/chat", "/chat/saved", "/papers"])("does not consume proactive events in %s", (route) => {
  mocked.route = route
  mount()
  act(() => window.dispatchEvent(new Event("companion-check")))
  expect(mocked.remote).not.toHaveBeenCalled()
})

it("aborts and discards a late reply after navigation to Chat", async () => {
  const hook = mount()
  act(() => draft(reply))
  expect(useCompanionStore.getState().current).not.toBeNull()
  mocked.route = "/chat"
  hook.rerender()
  expect(signal.aborted).toBe(true)
  await act(async () => { draft(reply); resolve(reply) })
  expect(useCompanionStore.getState().current).toBeNull()
  expect(mocked.remote).toHaveBeenCalledTimes(1)
})

it("clears an in-flight message when Settings opens", async () => {
  mount()
  act(() => useUIStore.getState().openSettingsModal("sources"))
  await act(async () => { draft(reply); resolve(reply) })
  expect(signal.aborted).toBe(true)
  expect(useCompanionStore.getState().current).toBeNull()
  expect(mocked.remote).toHaveBeenCalledTimes(1)
})

it("does not interrupt typing that starts while the AI is responding", async () => {
  mount()
  const input = document.createElement("textarea")
  document.body.append(input)
  act(() => input.focus())
  await act(async () => { draft(reply); resolve(reply) })
  expect(signal.aborted).toBe(true)
  expect(useCompanionStore.getState().current).toBeNull()
})

it("keeps a user-initiated thumbs-down question during route cleanup", () => {
  const hook = mount()
  const question = { paperKey: "paper-1", title: "A paper", revision: "vote-1" }
  act(() => useCompanionStore.getState().askFeedback(question))
  mocked.route = "/chat"
  hook.rerender()
  expect(useCompanionStore.getState().feedbackQuestions).toEqual([question])
  expect(useCompanionStore.getState().current).toBeNull()
})
