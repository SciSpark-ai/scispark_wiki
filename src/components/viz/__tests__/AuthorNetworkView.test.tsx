// @vitest-environment jsdom
//
// Task 10: AuthorNetworkView gains optional selection wiring. Only author
// nodes with a resolved wiki author page (`pageId !== null`) are
// selectable/navigable — pageless authors keep their existing no-op click
// (a native tooltip is their only affordance), unchanged by this task.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import AuthorNetworkView from "../AuthorNetworkView"
import type { AuthorNetwork } from "@/lib/viz/authors"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

function mount(el: React.ReactElement): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  return { host, root }
}

function unmount(root: Root, host: HTMLDivElement) {
  act(() => root.unmount())
  host.remove()
}

const NETWORK: AuthorNetwork = {
  nodes: [
    { key: "author one", name: "Author One", paperCount: 3, pageId: "wiki/authors/author-one" },
    { key: "author two", name: "Author Two", paperCount: 2, pageId: null },
  ],
  edges: [{ a: "author one", b: "author two", papers: 1 }],
}

describe("AuthorNetworkView selection", () => {
  beforeEach(() => {
    pushMock.mockClear()
  })

  it("renders a selected-state marker on the node matching selectedId", () => {
    const { host, root } = mount(
      <AuthorNetworkView network={NETWORK} selectedId="wiki/authors/author-one" onSelect={() => {}} />,
    )
    expect(host.querySelector('[data-selected="true"]')).toBeTruthy()
    unmount(root, host)
  })

  it("fires onSelect with the author's wiki page id when a paged node is clicked", () => {
    const onSelect = vi.fn()
    const { host, root } = mount(<AuthorNetworkView network={NETWORK} onSelect={onSelect} />)
    // Nodes render in paperCount-descending order — Author One (3) is first.
    const circle = host.querySelectorAll("circle")[0]
    expect(circle, "Author One's node should render").toBeTruthy()
    act(() => {
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith("wiki/authors/author-one")
    expect(pushMock).not.toHaveBeenCalled()
    unmount(root, host)
  })

  it("does not fire onSelect for a node with no wiki author page", () => {
    const onSelect = vi.fn()
    const { host, root } = mount(<AuthorNetworkView network={NETWORK} onSelect={onSelect} />)
    const circle = host.querySelectorAll("circle")[1] // Author Two, pageId: null
    act(() => {
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).not.toHaveBeenCalled()
    unmount(root, host)
  })

  it("renders identically for an unknown selectedId as for none", () => {
    const none = mount(<AuthorNetworkView network={NETWORK} onSelect={() => {}} />)
    const unknown = mount(
      <AuthorNetworkView network={NETWORK} selectedId="wiki/authors/does-not-exist" onSelect={() => {}} />,
    )
    expect(unknown.host.innerHTML).toBe(none.host.innerHTML)
    unmount(none.root, none.host)
    unmount(unknown.root, unknown.host)
  })

  it("marks its root container with data-viz-canvas", () => {
    const { host, root } = mount(<AuthorNetworkView network={NETWORK} onSelect={() => {}} />)
    expect(host.querySelector("[data-viz-canvas]")).toBeTruthy()
    unmount(root, host)
  })

  it("falls back to navigating when onSelect is not provided (back-compat)", () => {
    const { host, root } = mount(<AuthorNetworkView network={NETWORK} />)
    const circle = host.querySelectorAll("circle")[0]
    act(() => {
      circle.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(pushMock).toHaveBeenCalledWith("/wiki/authors/author-one")
    unmount(root, host)
  })
})
