// @vitest-environment jsdom
//
// Task 10: TimelineView gains optional selection wiring (`selectedId` /
// `onSelect`), unifying it with GraphView's already-live selection model.
// Clicking an item selects it (Inspector opens) when `onSelect` is passed;
// VizWorkspace is this view's sole production caller and always wires it,
// so with no `onSelect` a click is simply a no-op (no navigate fallback —
// there is no other production caller to preserve stand-alone behavior for).
import { describe, it, expect, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import TimelineView from "../TimelineView"
import type { Timeline } from "@/lib/viz/timeline"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

const TIMELINE: Timeline = {
  lanes: [{ id: "wiki/topics/t1", title: "Topic One", itemCount: 2 }],
  items: [
    {
      id: "wiki/papers/p1",
      title: "Paper One",
      type: "paper",
      date: "2024-01-01",
      year: 2024,
      laneIds: ["wiki/topics/t1"],
    },
    {
      id: "wiki/findings/f1",
      title: "Finding One",
      type: "finding",
      date: "2023-01-01",
      year: 2023,
      laneIds: ["wiki/topics/t1"],
    },
  ],
  minYear: 2023,
  maxYear: 2024,
}

describe("TimelineView selection", () => {
  it("renders a selected-state marker on the item matching selectedId", () => {
    const { host, root } = mount(
      <TimelineView timeline={TIMELINE} selectedId="wiki/papers/p1" onSelect={() => {}} />,
    )
    expect(host.querySelector('[data-selected="true"]')).toBeTruthy()
    unmount(root, host)
  })

  it("fires onSelect with the item's page id on click", () => {
    const onSelect = vi.fn()
    const { host, root } = mount(<TimelineView timeline={TIMELINE} onSelect={onSelect} />)
    const circle = host.querySelector("circle")
    expect(circle, "at least one item circle should render").toBeTruthy()
    act(() => {
      circle!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledWith("wiki/papers/p1")
    unmount(root, host)
  })

  it("renders identically for an unknown selectedId as for none", () => {
    const none = mount(<TimelineView timeline={TIMELINE} onSelect={() => {}} />)
    const unknown = mount(
      <TimelineView timeline={TIMELINE} selectedId="wiki/papers/does-not-exist" onSelect={() => {}} />,
    )
    expect(unknown.host.innerHTML).toBe(none.host.innerHTML)
    unmount(none.root, none.host)
    unmount(unknown.root, unknown.host)
  })

  it("marks its root container with data-viz-canvas", () => {
    const { host, root } = mount(<TimelineView timeline={TIMELINE} onSelect={() => {}} />)
    expect(host.querySelector("[data-viz-canvas]")).toBeTruthy()
    unmount(root, host)
  })
})
