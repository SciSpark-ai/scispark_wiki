// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ProgressiveText } from "../ProgressiveText"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it("reveals scripted prompts progressively, resets per question, and cleans up its timer", () => {
  vi.useFakeTimers()
  const host = document.createElement("div")
  const root = createRoot(host)
  act(() => root.render(<ProgressiveText key="name" text="Hello researcher" />))
  const visible = () => host.querySelector(".absolute")!.textContent
  expect(visible()).toBe("")
  act(() => vi.advanceTimersByTime(48))
  expect(visible()).toBe("Hello ")
  act(() => vi.advanceTimersByTime(500))
  expect(visible()).toBe("Hello researcher")
  act(() => root.render(<ProgressiveText key="role" text="What is your field?" />))
  expect(visible()).toBe("")
  act(() => root.unmount())
  expect(vi.getTimerCount()).toBe(0)
})

it("shows the complete prompt immediately with reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const host = document.createElement("div")
  const root = createRoot(host)
  act(() => root.render(<ProgressiveText text="Hello researcher" />))
  expect(host.querySelector(".absolute")!.textContent).toBe("Hello researcher")
  act(() => root.unmount())
})
