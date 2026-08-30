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
  const field = host.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement
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

describe("OnboardingFlow", () => {
  it("opens in Ember's voice and asks for the user's name first", () => {
    const { host, root } = mount()

    expect(host.textContent).toContain("Ember")
    expect(host.textContent).toContain("What should I call you?")
    expect((host.querySelector("input") as HTMLInputElement).placeholder).toBe("Your name")
    expect(host.textContent).not.toContain("What kind of researcher are you?")

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
    })

    act(() => root.unmount())
    host.remove()
  })
})
