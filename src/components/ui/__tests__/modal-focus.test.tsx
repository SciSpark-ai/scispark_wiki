// @vitest-environment jsdom
import { act, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { expect, it } from "vitest"
import { useModalFocus } from "../useModalFocus"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("contains keyboard focus, makes the background inert, and restores focus on Escape", async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    const panel = useRef<HTMLDivElement>(null)
    useModalFocus(panel, open, () => setOpen(false))
    return <><button onClick={() => setOpen(true)}>Open</button><input aria-label="Background" />
      {open && <div ref={panel} role="dialog" tabIndex={-1}><button>First</button><button>Last</button></div>}</>
  }
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<Harness />))
  const trigger = host.querySelector("button")!
  trigger.focus()
  await act(async () => trigger.click())
  const panel = host.querySelector('[role="dialog"]') as HTMLElement
  const [first, last] = [...panel.querySelectorAll("button")]
  expect(document.activeElement).toBe(panel)
  expect(trigger.hasAttribute("inert")).toBe(true)
  act(() => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(last)
  act(() => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  act(() => host.querySelector("input")!.focus())
  expect(panel.contains(document.activeElement)).toBe(true)
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(trigger.hasAttribute("inert")).toBe(false)
  expect(document.activeElement).toBe(trigger)
  act(() => root.unmount()); host.remove()
})
