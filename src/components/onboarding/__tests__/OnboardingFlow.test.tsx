// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { OnboardingFlow } from "../OnboardingFlow"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(onSubmit = vi.fn()) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => root.render(<OnboardingFlow onSubmit={onSubmit} />))
  return { host, root, onSubmit }
}

function setComposer(host: HTMLElement, value: string) {
  const field = host.querySelector('input:not([type="radio"]):not([type="checkbox"]), textarea') as HTMLInputElement | HTMLTextAreaElement
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function send(host: HTMLElement) {
  const button = host.querySelector('button[aria-label="Send answer"], button[aria-label="Create my research space"]')
  act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
}

function pressEnter(host: HTMLElement, options: KeyboardEventInit = {}) {
  const field = host.querySelector('input:not([type="radio"]):not([type="checkbox"]), textarea') as HTMLInputElement | HTMLTextAreaElement
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options })
  act(() => field.dispatchEvent(event))
  return event
}

describe("OnboardingFlow", () => {
  it("scrolls only the transcript when advancing and leaves scrollback alone while typing", () => {
    const { host, root } = mount()
    const history = host.querySelector('[role="log"]') as HTMLDivElement
    Object.defineProperty(history, "scrollHeight", { configurable: true, value: 900 })

    setComposer(host, "Ada")
    send(host)
    expect(history.scrollTop).toBe(900)

    history.scrollTop = 100
    setComposer(host, "Postdoc")
    expect(history.scrollTop).toBe(100)
    send(host)
    expect(history.scrollTop).toBe(900)

    act(() => root.unmount())
    host.remove()
  })

  it("opens in Sparky's voice and asks for the user's name first", () => {
    const { host, root } = mount()

    expect(host.textContent).toContain("Sparky")
    expect(host.textContent).toContain("What should I call you?")
    expect((host.querySelector("input") as HTMLInputElement).placeholder).toBe("Your name")
    expect(host.textContent).not.toContain("What kind of researcher are you?")

    act(() => root.unmount())
    host.remove()
  })

  it("uses a theme-aware inverse surface for completed user responses", () => {
    const { host, root } = mount()

    setComposer(host, "Ada")
    send(host)

    const response = Array.from(host.querySelectorAll("p")).find((node) => node.textContent === "Ada")
    expect(response?.className).toContain("bg-secondary-dark")
    expect(response?.className).toContain("text-page-bg")
    expect(response?.className).not.toContain("text-white")

    act(() => root.unmount())
    host.remove()
  })

  it("keeps a companion transcript and submits all five answers", () => {
    const onSubmit = vi.fn()
    const { host, root } = mount(onSubmit)

    setComposer(host, "Ada")
    send(host)
    expect(host.textContent).toContain("Nice to meet you, Ada")

    setComposer(host, "Research fellow")
    send(host)
    setComposer(host, "Neuroscience")
    send(host)
    setComposer(host, "Auditory attention\nLanguage development")
    send(host)
    setComposer(host, "Methods-heavy papers")
    send(host)

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ada",
      role: "Research fellow",
      fields: "Neuroscience",
      topics: "Auditory attention\nLanguage development",
      feedPrefs: "Methods-heavy papers",
      recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null },
    })

    act(() => root.unmount())
    host.remove()
  })

  it("sends each answer with Enter, including the final answer, while respecting required fields", () => {
    const { host, root, onSubmit } = mount()

    pressEnter(host)
    expect(host.querySelector("input")).not.toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()

    for (const answer of ["Ada", "Postdoc", "Neuroscience", "Auditory attention", "Recent methods"] ) {
      setComposer(host, answer)
      expect(pressEnter(host).defaultPrevented).toBe(true)
    }

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      name: "Ada",
      role: "Postdoc",
      fields: "Neuroscience",
      topics: "Auditory attention",
      feedPrefs: "Recent methods",
      recommendations: { diversity: "balanced", learnFromFeedback: true, resetAt: null },
    })

    act(() => root.unmount())
    host.remove()
  })

  it("preserves Shift+Enter for newlines and never sends while confirming composed text", () => {
    const { host, root, onSubmit } = mount()
    setComposer(host, "Ada")
    expect(pressEnter(host, { isComposing: true }).defaultPrevented).toBe(false)
    expect(pressEnter(host, { keyCode: 229 }).defaultPrevented).toBe(false)
    expect(host.querySelector("input")).not.toBeNull()
    pressEnter(host)

    setComposer(host, "Postdoc")
    expect(pressEnter(host, { shiftKey: true }).defaultPrevented).toBe(false)
    expect(pressEnter(host, { isComposing: true }).defaultPrevented).toBe(false)
    expect(host.textContent).toContain("2 of 5")
    expect(onSubmit).not.toHaveBeenCalled()

    setComposer(host, "Postdoc\nAuditory neuroscience")
    pressEnter(host)
    expect(host.textContent).toContain("Postdoc\nAuditory neuroscience")
    expect(host.textContent).toContain("3 of 5")

    act(() => root.unmount())
    host.remove()
  })
})
