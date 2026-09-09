// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { FeedbackQuestion } from "../FeedbackQuestion"
import { useCompanionStore } from "@/stores/companion-store"

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock("@/lib/recommendation/client", () => ({ sendRecommendationFeedback: send }))
vi.mock("@/lib/companion/settings-client", () => ({ loadCompanionSettingsRemote: async () => ({ companionName: "Sparky" }) }))
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const question = { paperKey: "doi:10/test", title: "A research paper", revision: "a".repeat(64) }
let host: HTMLDivElement, root: Root
beforeEach(async () => {
  send.mockReset().mockResolvedValue({ learningEnabled: true, warnings: [] })
  useCompanionStore.setState({ feedbackQuestions: [question] })
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(<FeedbackQuestion question={question} />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const button = (name: string) => [...host.querySelectorAll("button")].find((entry) => entry.textContent === name)!
const choose = (value: string) => act(() => host.querySelector<HTMLInputElement>(`input[value="${value}"]`)!.click())

it("asks an optional question, focuses the panel and allows skipping without another write", () => {
  expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'))
  expect(button("Save preference").disabled).toBe(true)
  act(() => button("Skip").click())
  expect(send).not.toHaveBeenCalled()
  expect(useCompanionStore.getState().feedbackQuestions).toEqual([])
})

it("saves a reason with its original revision and acknowledges memory only after success", async () => {
  choose("wrong_method")
  await act(async () => button("Save preference").click())
  expect(send).toHaveBeenCalledWith(question.paperKey, "wrong_method", { note: "", expectedRevision: question.revision })
  expect(host.textContent).toContain("saved this to your feed memory")
  expect(button("Done")).toBeTruthy()
})

it("preserves the selection after failure and accurately acknowledges disabled learning", async () => {
  send.mockRejectedValueOnce(new Error("Your feedback changed elsewhere."))
  choose("too_old")
  await act(async () => button("Save preference").click())
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere")
  expect(host.querySelector<HTMLInputElement>('input[value="too_old"]')!.checked).toBe(true)
  send.mockResolvedValueOnce({ learningEnabled: false, warnings: [] })
  await act(async () => button("Save preference").click())
  expect(host.textContent).toContain("Learning is off")
})

it("requires an explanation for Something else", () => {
  choose("other")
  expect(button("Save preference").disabled).toBe(true)
})

it("records already-read feedback without promising to hide the current paper", async () => {
  choose("already_know")
  await act(async () => button("Save preference").click())
  expect(send).toHaveBeenCalledWith(question.paperKey, "already_know", { note: "", expectedRevision: question.revision })
  expect(host.querySelector('[role="status"]')?.textContent).toContain("It will stay in this feed.")
})
