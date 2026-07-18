// @vitest-environment jsdom
//
// SP2 Task 13: /papers is now search-only — the crammed inline detail/digest
// sub-card is gone, and each result routes straight to `/paper/<slug>`. This
// item itself stays a dumb row (title/venue/id-badges) that fires `onSelect`
// on click; the page owns writing the reader handoff and navigating (see
// papers/page.tsx's handleOpenPaper).
import { describe, it, expect, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { PaperRecord } from "@/lib/papers/types"
import { PaperResultItem } from "../PaperResultItem"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710", doi: "10.1/x" },
  title: "Ear-EEG for <i>Auditory</i> Attention Decoding",
  authors: [{ name: "A. Author" }],
  venue: "NeurIPS",
  year: 2024,
  citationCount: 12,
  fields: [],
  source: "arxiv",
}

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("PaperResultItem (SP2 Task 13: search-only /papers)", () => {
  it("renders displayTitle (markup stripped), venue/year/citations, and id badges", async () => {
    const { host, root } = mount()

    await act(async () => {
      root.render(<PaperResultItem paper={PAPER} onSelect={() => {}} />)
    })

    expect(host.textContent).toContain("Ear-EEG for Auditory Attention Decoding")
    expect(host.innerHTML).not.toContain("<i>Auditory</i>")
    expect(host.textContent).toContain("NeurIPS")
    expect(host.textContent).toContain("2024")
    expect(host.textContent).toContain("12 citations")
    expect(host.textContent).toContain("2409.08710")

    act(() => root.unmount())
    host.remove()
  })

  it("calls onSelect when clicked (the page navigates to /paper/<slug>)", async () => {
    const onSelect = vi.fn()
    const { host, root } = mount()

    await act(async () => {
      root.render(<PaperResultItem paper={PAPER} onSelect={onSelect} />)
    })

    const button = host.querySelector("button")
    expect(button).toBeTruthy()

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    host.remove()
  })
})
