import { beforeEach, expect, it } from "vitest"
import { useCompanionStore } from "../companion-store"

const draft = { text: "Hello", trigger: "app-open", action: null, costUsd: 0, fromTemplate: false }
const state = useCompanionStore.getState
beforeEach(() => {
  state().dismiss()
  useCompanionStore.setState({ sessionShownCount: 0, lastShownTs: {}, feedbackQuestions: [] })
})

it("counts one intervention across tokens and retries, and only exposes the action at completion", () => {
  const id = state().beginStream()!
  expect(state().beginStream()).toBeNull()
  state().updateStream(id, { ...draft, text: "" })
  expect(state().sessionShownCount).toBe(0)
  state().updateStream(id, draft)
  state().updateStream(id, { ...draft, text: "" })
  state().updateStream(id, { ...draft, text: "Hello again" })
  expect(state().sessionShownCount).toBe(1)
  expect(state().current?.action).toBeNull()
  state().finishStream(id, { ...draft, action: { label: "Home", href: "/" } })
  expect(state().sessionShownCount).toBe(1)
  expect(state().streamId).toBeNull()
  expect(state().current?.action?.href).toBe("/")
})

it("does not resurrect a bubble dismissed during a stream", () => {
  const id = state().beginStream()!
  state().updateStream(id, draft)
  state().dismiss()
  state().updateStream(id, { ...draft, text: "Late chunk" })
  state().finishStream(id, draft)
  expect(state().current).toBeNull()
  expect(state().sessionShownCount).toBe(1)
})

it("prioritizes and queues user feedback without late proactive replies replacing it", () => {
  const id = state().beginStream()!
  const question = { paperKey: "one", title: "First paper", revision: "abc" }
  state().askFeedback(question)
  state().askFeedback(question)
  state().askFeedback({ ...question, paperKey: "two" })
  expect(state().feedbackQuestions).toHaveLength(2)
  expect(state().beginStream()).toBeNull()
  state().finishStream(id, draft)
  state().show(draft)
  expect(state().current).toBeNull()
  expect(state().sessionShownCount).toBe(0)
  state().closeFeedback("one")
  expect(state().feedbackQuestions[0].paperKey).toBe("two")
  state().closeFeedback("two")
  expect(state().beginStream()).not.toBeNull()
})
