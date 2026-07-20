// @vitest-environment jsdom
//
// Tong, 2026-07-19: "when i click the card from home page to go to papers,
// when i click back arrow, it goes to Search, instead of home." The old
// control was a hardcoded <Link href="/papers">. These tests pin the two
// behaviors that replace it: go BACK when there's in-app history, and fall
// back to a real href when there isn't (direct load / pasted link).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NAV_CURRENT_KEY, NAV_DEPTH_KEY } from "@/lib/ui/nav-history"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const backMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: backMock, push: vi.fn() }),
}))
// next/link renders a plain anchor here so a real click carries through to
// the component's own onClick (which is the thing under test).
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { BackLink } from "../BackLink"

function mount(ui: React.ReactElement): { host: HTMLDivElement; root: Root; anchor: HTMLAnchorElement } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(ui)
  })
  return { host, root, anchor: host.querySelector("a")! }
}

/** Dispatches a cancelable left click and reports whether it was prevented. */
function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init })
  act(() => {
    anchor.dispatchEvent(event)
  })
  return event.defaultPrevented
}

describe("BackLink", () => {
  beforeEach(() => {
    backMock.mockClear()
    window.sessionStorage.clear()
  })

  it("goes back in history when the user navigated within the app", () => {
    window.sessionStorage.setItem(NAV_DEPTH_KEY, "2")
    window.sessionStorage.setItem(NAV_CURRENT_KEY, "/paper/x")
    const { anchor, root, host } = mount(<BackLink />)

    const prevented = click(anchor)

    expect(backMock).toHaveBeenCalledTimes(1)
    // The anchor navigation is suppressed so the browser doesn't ALSO go to
    // the fallback href.
    expect(prevented).toBe(true)

    act(() => root.unmount())
    host.remove()
  })

  it("falls through to the fallback href on a direct load (no in-app history)", () => {
    const { anchor, root, host } = mount(<BackLink fallbackHref="/" />)

    const prevented = click(anchor)

    expect(backMock).not.toHaveBeenCalled()
    // Not prevented => the browser performs the normal navigation to href.
    expect(prevented).toBe(false)
    expect(anchor.getAttribute("href")).toBe("/")

    act(() => root.unmount())
    host.remove()
  })

  it("never hijacks modified clicks (open-in-new-tab must still work)", () => {
    window.sessionStorage.setItem(NAV_DEPTH_KEY, "2")
    const { anchor, root, host } = mount(<BackLink />)

    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      expect(click(anchor, mod)).toBe(false)
    }
    expect(backMock).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })

  it("renders the arrow affordance and a custom label/fallback", () => {
    const { anchor, root, host } = mount(<BackLink fallbackHref="/wiki">Back to wiki</BackLink>)
    expect(anchor.textContent).toContain("←")
    expect(anchor.textContent).toContain("Back to wiki")
    expect(anchor.getAttribute("href")).toBe("/wiki")

    act(() => root.unmount())
    host.remove()
  })
})
