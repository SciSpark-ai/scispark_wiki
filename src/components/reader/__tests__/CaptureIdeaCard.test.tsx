// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import CaptureIdeaCard from "../CaptureIdeaCard"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Array<Root> = []

function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  roots.push(root)
  return {
    host,
    rerender: (next: React.ReactElement) => act(() => root.render(next)),
  }
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

const BASE = {
  selectionText: "Auditory Attention Decoding (AAD)",
  saving: false,
  error: null as string | null,
  anchorTop: 120,
  anchorLeft: 340,
}

function setTextarea(host: HTMLElement, value: string) {
  const textarea = host.querySelector("textarea")!
  // React 19 tracks the value setter; go through the native setter + input event.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!
  act(() => {
    setter.call(textarea, value)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("CaptureIdeaCard", () => {
  it("shows the selected passage and saves with the typed thought", () => {
    const onSave = vi.fn()
    const { host } = mount(<CaptureIdeaCard {...BASE} onSave={onSave} onCancel={() => {}} />)

    expect(host.textContent).toContain("Auditory Attention Decoding (AAD)")

    setTextarea(host, "connect this to my TRF project")
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")!
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSave).toHaveBeenCalledWith("connect this to my TRF project")
  })

  it("saves with an empty thought (thought is optional)", () => {
    const onSave = vi.fn()
    const { host } = mount(<CaptureIdeaCard {...BASE} onSave={onSave} onCancel={() => {}} />)
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")!
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSave).toHaveBeenCalledWith("")
  })

  it("cancels via the Cancel button and via Escape", () => {
    const onCancel = vi.fn()
    const { host } = mount(<CaptureIdeaCard {...BASE} onSave={() => {}} onCancel={onCancel} />)

    const cancel = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Cancel")!
    act(() => {
      cancel.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)

    const textarea = host.querySelector("textarea")!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it("surfaces a save error instead of failing silently", () => {
    const { host } = mount(
      <CaptureIdeaCard {...BASE} error="changeset conflict: index.md changed" onSave={() => {}} onCancel={() => {}} />,
    )
    expect(host.textContent).toContain("changeset conflict: index.md changed")
  })

  it("disables Save while saving", () => {
    const { host } = mount(<CaptureIdeaCard {...BASE} saving={true} onSave={() => {}} onCancel={() => {}} />)
    const save = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Saving"))!
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })
})
