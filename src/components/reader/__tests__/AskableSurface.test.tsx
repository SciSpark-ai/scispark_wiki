// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { PaperRecord } from "@/lib/papers/types"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import type { SurfaceSelection } from "../HtmlSurface"
import type { AskableSurfaceRenderProps } from "../AskableSurface"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// This is the extracted contract's regression guard (Task 7): AskableSurface
// owns the select→ask and select→capture-idea flows that used to live
// directly in ReaderView. Everything that talks to the network is mocked;
// buildAskContext/logEvent run for real against an in-memory vault (cheap,
// deterministic, no I/O).
vi.mock("@/lib/reader/client", () => ({ askRemote: vi.fn() }))
vi.mock("@/lib/companion/settings-client", () => ({ loadCompanionSettingsRemote: vi.fn() }))
vi.mock("@/lib/reader/capture-idea", () => ({ captureIdeaAsNote: vi.fn() }))

import { askRemote } from "@/lib/reader/client"
import { loadCompanionSettingsRemote } from "@/lib/companion/settings-client"
import { captureIdeaAsNote } from "@/lib/reader/capture-idea"

import AskableSurface from "../AskableSurface"

const askRemoteMock = vi.mocked(askRemote)
const loadCompanionSettingsRemoteMock = vi.mocked(loadCompanionSettingsRemote)
const captureIdeaAsNoteMock = vi.mocked(captureIdeaAsNote)

let roots: Root[] = []

function mount(el: React.ReactElement) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  roots.push(root)
  return { host, rerender: (next: React.ReactElement) => act(() => root.render(next)) }
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

const PAPER: PaperRecord = {
  ids: { arxiv: "2401.00001" },
  title: "Sparse Attention Transformers",
  authors: [{ name: "Ada Lovelace" }],
  fields: [],
  source: "arxiv",
}

const SELECTION: SurfaceSelection = { start: 0, end: 11, text: "hello world", rectTop: 100, rectLeft: 50 }

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)
  if (!btn) throw new Error(`button "${text}" not found`)
  return btn
}

/** Scoped to the selection bubble (`role="toolbar"`) — its "Ask" button has
 * the same text as AskPanel's (initially-disabled) submit button, so a
 * document-wide text match is ambiguous and would silently click the wrong
 * (disabled, inert) one. */
function findBubbleButton(host: HTMLElement, text: string): HTMLButtonElement {
  const toolbar = host.querySelector('[role="toolbar"]')
  if (!toolbar) throw new Error("selection bubble not rendered")
  const btn = Array.from(toolbar.querySelectorAll("button")).find((b) => b.textContent === text)
  if (!btn) throw new Error(`bubble button "${text}" not found`)
  return btn
}

/** Waits out every pending microtask (a macrotask boundary guarantees the
 * whole microtask queue — including chained async/awaits inside runAsk —
 * has drained) inside act() so state updates from a fire-and-forget async
 * handler are flushed and reflected in the DOM before assertions run. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderSurface(props: Partial<React.ComponentProps<typeof AskableSurface>> = {}) {
  const storage = new MemoryVaultStorage()
  let latest: AskableSurfaceRenderProps | null = null
  // Mirrors real usage (ReaderView): the wrapped content and the askPanel
  // both get mounted from the same render-prop call, same as a caller would
  // place askPanel in a separate sidebar alongside the content region.
  const { host } = mount(
    <AskableSurface storage={storage} paper={PAPER} surfaceText="hello world, this is the surrounding text" {...props}>
      {(renderProps) => {
        latest = renderProps
        return (
          <>
            <div data-testid="content">paper content</div>
            <div data-testid="ask-panel">{renderProps.askPanel}</div>
          </>
        )
      }}
    </AskableSurface>,
  )
  return {
    host,
    storage,
    getRenderProps: () => {
      if (!latest) throw new Error("render props not captured")
      return latest as AskableSurfaceRenderProps
    },
  }
}

describe("AskableSurface", () => {
  it("renders children and stays bubble-free with no selection", () => {
    const { host } = renderSurface()
    expect(host.textContent).toContain("paper content")
    expect(host.querySelector('[role="toolbar"]')).toBeNull()
  })

  it("shows the selection bubble once a selection is reported", () => {
    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    expect(host.querySelector('[role="toolbar"]')).not.toBeNull()
    expect(host.textContent).toContain("Ask")
    expect(host.textContent).toContain("Capture idea")
  })

  it("hides the Highlight action by default, shows it and forwards clicks when enableHighlight is set", () => {
    const onHighlight = vi.fn()
    const { host, getRenderProps } = renderSurface({ enableHighlight: true, onHighlight })
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    expect(host.textContent).toContain("Highlight")

    act(() => findBubbleButton(host, "Highlight").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(onHighlight).toHaveBeenCalledWith(SELECTION)
    // Clicking Highlight snapshots + clears the live selection — the bubble
    // must disappear immediately (same "clearSelection" semantics ReaderView
    // relied on before extraction).
    expect(host.querySelector('[role="toolbar"]')).toBeNull()
  })

  it("without enableHighlight, the bubble never shows a Highlight action", () => {
    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    expect(host.textContent).not.toContain("Highlight")
  })

  it("clicking Ask calls askRemote and renders the answer with cited pages", async () => {
    loadCompanionSettingsRemoteMock.mockResolvedValue({ companionName: "Ember", chattiness: "medium" })
    askRemoteMock.mockResolvedValue({ answer: "It means the model attends sparsely.", citedPageIds: ["wiki/concepts/sparse-attention"] })

    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Ask").dispatchEvent(new MouseEvent("click", { bubbles: true })))

    await flush()

    expect(askRemoteMock).toHaveBeenCalledTimes(1)
    const call = askRemoteMock.mock.calls[0][0]
    expect(call.selection).toBe("hello world")
    expect(host.textContent).toContain("It means the model attends sparsely.")
    expect(host.textContent).toContain("wiki/concepts/sparse-attention")
  })

  it("keeps showing the asked passage in the Ask panel even after the live selection collapses", async () => {
    loadCompanionSettingsRemoteMock.mockResolvedValue({ companionName: "Ember", chattiness: "medium" })
    askRemoteMock.mockResolvedValue({ answer: "answer text", citedPageIds: [] })

    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Ask").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()

    expect(host.textContent).toContain("Selected passage")
    expect(host.textContent).toContain("hello world")

    // Simulate the browser collapsing the native selection (e.g. focusing
    // another field) — the SP1-era invariant is that the Ask panel's target
    // is snapshotted independently and must not revert to "no selection".
    act(() => getRenderProps().onHtmlSelectionChange(null))
    expect(host.textContent).toContain("Selected passage")
    expect(host.textContent).toContain("hello world")
  })

  it("Capture opens the inline card with the selected passage", () => {
    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Capture idea").dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain("hello world")
    // Opening the card clears the live selection immediately (bubble gone).
    expect(host.querySelector('[role="toolbar"]')).toBeNull()
  })

  it("typing in the capture textarea (which collapses the native selection) does not dismiss the card", () => {
    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Capture idea").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()

    // The browser's selectionchange fires with null once the textarea steals
    // focus — captureState must be immune to this (snapshotted at open-time).
    act(() => getRenderProps().onHtmlSelectionChange(null))
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain("hello world")
  })

  it("saving a captured idea calls captureIdeaAsNote with sourcePageId threaded through and shows the confirmation link", async () => {
    captureIdeaAsNoteMock.mockResolvedValue({ changesetId: "cs1", path: "wiki/notes/hello-world.md" })

    const { host, getRenderProps } = renderSurface({ sourcePageId: "wiki/papers/sparse-attn" })
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Capture idea").dispatchEvent(new MouseEvent("click", { bubbles: true })))

    act(() => findButton(host, "Save").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()

    expect(captureIdeaAsNoteMock).toHaveBeenCalledTimes(1)
    const input = captureIdeaAsNoteMock.mock.calls[0][0]
    expect(input.sourcePageId).toBe("wiki/papers/sparse-attn")
    expect(input.selection).toBe("hello world")
    expect(input.paperKey).toBe("arxiv:2401.00001")

    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain("Idea captured.")
    expect(host.textContent).toContain("View note")
  })

  it("surfaces a capture save error inline instead of failing silently", async () => {
    captureIdeaAsNoteMock.mockRejectedValue(new Error("changeset conflict: index.md changed"))

    const { host, getRenderProps } = renderSurface()
    act(() => getRenderProps().onHtmlSelectionChange(SELECTION))
    act(() => findBubbleButton(host, "Capture idea").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    act(() => findButton(host, "Save").dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()

    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    expect(host.textContent).toContain("changeset conflict: index.md changed")
  })

  it("exposes an askPanel render prop that reflects idle state with no selection", () => {
    const { getRenderProps } = renderSurface()
    // Mount a second host to render just the panel and inspect it.
    const panelHost = document.createElement("div")
    document.body.appendChild(panelHost)
    const panelRoot = createRoot(panelHost)
    act(() => panelRoot.render(<>{getRenderProps().askPanel}</>))
    roots.push(panelRoot)
    expect(panelHost.textContent).toContain("Select text in the paper")
    panelHost.remove()
  })
})
