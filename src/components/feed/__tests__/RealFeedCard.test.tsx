// @vitest-environment jsdom
//
// Task 12 gate (see .superpowers/sdd/task-12-brief.md Step 2): the feed card
// becomes a scannable Apple-News-style card — headline + AI TL;DR + small tag
// chips, no bare numeric score, no why-this/you/now prose (that now lives on
// /paper/[key], see PaperSavedState.test.tsx) — and the WHOLE card links
// through to /paper/<slug>. Footer Save/Dismiss must stop click-propagation
// so clicking them doesn't also fire the card navigation.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryVaultStorage } from "@/lib/vault/memory-storage"
import { paperSlug } from "@/lib/wiki/authoring"
import type { FeedItem } from "@/lib/skills/feed"
import type { PaperRecord } from "@/lib/papers/types"
import { useCompanionStore } from "@/stores/companion-store"
import { sendRecommendationFeedback } from "@/lib/recommendation/client"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const pushMock = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}))

const { mockSavePaper } = vi.hoisted(() => ({
  mockSavePaper: vi.fn(async () => ({ saved: true, slug: "some-slug" })),
}))
vi.mock("@/lib/papers/save-client", () => ({
  savePaper: mockSavePaper,
}))

import { RealFeedCard } from "../RealFeedCard"
vi.mock("@/lib/recommendation/client", () => ({ sendRecommendationFeedback: vi.fn(async () => ({ changesetId: "cs-test", revision: "a".repeat(64), warnings: [] })) }))

const PAPER: PaperRecord = {
  ids: { arxiv: "2409.08710" },
  title: "Ear-EEG for <i>Auditory</i> Attention Decoding",
  authors: [{ name: "A. Author" }, { name: "B. Author" }],
  abstract: "We study ear-EEG. It works well. More detail follows.",
  venue: "NeurIPS",
  year: 2024,
  fields: [],
  source: "arxiv",
}

function itemFor(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    paper: PAPER,
    score: 87,
    whyThis: "Matches your recent reading on ear-EEG.",
    whyYou: "You saved two related papers this week.",
    whyNow: "Published this month.",
    ...overrides,
  }
}

function mount(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  return { host, root }
}

describe("RealFeedCard (SP2 Task 12 redesign)", () => {
  beforeEach(() => {
    pushMock.mockClear()
    mockSavePaper.mockClear()
    vi.mocked(sendRecommendationFeedback).mockClear()
    useCompanionStore.setState({ feedbackQuestions: [] })
  })

  it("shows displayTitle, venue·year, tldr, and tag chips — no score, no why-lines", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A wearable ear-EEG method for tracking attention.", tags: ["ear-eeg", "attention"] })
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={() => {}} />,
      )
    })

    // displayTitle strips markup.
    expect(host.textContent).toContain("Ear-EEG for Auditory Attention Decoding")
    expect(host.innerHTML).not.toContain("<i>Auditory</i>")

    // venue · year
    expect(host.textContent).toContain("NeurIPS")
    expect(host.textContent).toContain("2024")

    // tldr
    expect(host.textContent).toContain("A wearable ear-EEG method for tracking attention.")

    // tag chips
    expect(host.textContent).toContain("ear-eeg")
    expect(host.textContent).toContain("attention")

    // no bare numeric score chip (word-boundary match: the arxiv id
    // "2409.08710" innocently contains "87" as a substring)
    expect(host.textContent).not.toMatch(/\b87\b/)

    // no why-this/you/now prose block
    expect(host.textContent).not.toContain("Why this:")
    expect(host.textContent).not.toContain("Why you:")
    expect(host.textContent).not.toContain("Why now:")
    expect(host.textContent).not.toContain(item.whyThis)
    expect(host.textContent).not.toContain(item.whyYou)
    expect(host.textContent).not.toContain(item.whyNow)

    act(() => root.unmount())
    host.remove()
  })

  it("renders the why-badge as the colored header band (SP2.1)", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A tldr.", tags: ["ear-eeg"], badge: "high-impact" })
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={() => {}} />,
      )
    })

    // The band is the card's first child, carries the badge's label and its
    // token-backed color class (Tong 2026-07-19: the why-reason IS the band,
    // not a category strip).
    const band = (host.firstElementChild as HTMLElement).firstElementChild as HTMLElement
    expect(band.textContent).toBe("High impact")
    expect(band.className).toContain("bg-band-impact")

    act(() => root.unmount())
    host.remove()
  })

  it("band degrades to a neutral first-tag strip when the item has no badge (old cache)", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A tldr.", tags: ["ear-eeg", "attention"] })
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={() => {}} />,
      )
    })

    const band = (host.firstElementChild as HTMLElement).firstElementChild as HTMLElement
    expect(band.textContent).toBe("ear-eeg")
    expect(band.className).toContain("bg-warm-tan")

    act(() => root.unmount())
    host.remove()
  })

  it("falls back to abstract-first-sentence tldr and source/year tags when item.tldr/tags are absent", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor() // no tldr, no tags
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={() => {}} />,
      )
    })

    // fallback tldr: paper.abstract.split(". ")[0] — the delimiter's period
    // is consumed by the split, so the fragment has no trailing period.
    expect(host.textContent).toContain("We study ear-EEG")
    // shouldn't include the rest of the abstract
    expect(host.textContent).not.toContain("It works well")
    expect(host.textContent).not.toContain("More detail follows")

    // fallback tags: [source, year]
    expect(host.textContent).toContain("arxiv")
    expect(host.textContent).toContain("2024")

    act(() => root.unmount())
    host.remove()
  })

  it("shows a cleaned venue·year line and never a 'no venue' placeholder", async () => {
    const storage = new MemoryVaultStorage()
    const preprint: PaperRecord = { ...PAPER, venue: "bioRxiv (Cold Spring Harbor Laboratory)", year: 2026 }
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard
          item={itemFor({ paper: preprint, tldr: "A tldr.", tags: ["x"] })}
          storage={storage}
          saved={false}
          onSave={() => {}}
          onDismiss={() => {}}
        />,
      )
    })

    // Publisher parenthetical dropped so the real venue survives truncation.
    expect(host.textContent).toContain("bioRxiv · 2026")
    expect(host.textContent).not.toContain("Cold Spring Harbor")

    act(() => root.unmount())
    host.remove()
  })

  it("omits the venue entirely (not 'no venue') when the paper has none", async () => {
    const storage = new MemoryVaultStorage()
    const noVenue: PaperRecord = { ...PAPER, venue: undefined, year: 2026 }
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard
          item={itemFor({ paper: noVenue, tldr: "A tldr.", tags: ["x"] })}
          storage={storage}
          saved={false}
          onSave={() => {}}
          onDismiss={() => {}}
        />,
      )
    })

    expect(host.textContent).not.toContain("no venue")
    expect(host.textContent).not.toContain("—")
    expect(host.textContent).toContain("2026")

    act(() => root.unmount())
    host.remove()
  })

  it("routes the whole card to /paper/<slug> on click", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A tldr.", tags: ["tag-a"] })
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={() => {}} />,
      )
    })

    const cardRoot = host.firstElementChild as HTMLElement
    expect(cardRoot).toBeTruthy()

    await act(async () => {
      cardRoot.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(pushMock).toHaveBeenCalledWith(`/paper/${paperSlug(PAPER)}`)

    act(() => root.unmount())
    host.remove()
  })

  it("Save calls savePaper and does not navigate (footer stops propagation)", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A tldr.", tags: ["tag-a"] })
    const onSave = vi.fn()
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={onSave} onDismiss={() => {}} />,
      )
    })

    const saveButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Save")
    expect(saveButton, "Save button should be present").toBeTruthy()

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    // Flush the savePaper() await inside handleSave.
    await act(async () => {})

    expect(mockSavePaper).toHaveBeenCalledWith(storage, PAPER)
    expect(onSave).toHaveBeenCalledWith(expect.any(String))
    expect(pushMock).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })

  it.each([
    ["More like this", "more_like_this", false],
    ["Less like this", "less_like_this", false],
    ["Too old", "too_old", true],
    ["Already read this", "already_know", true],
  ] as const)("%s saves feedback without dismissing the paper or navigating", async (label, reason, inMenu) => {
    const onDismiss = vi.fn()
    const { host, root } = mount()
    try {
      await act(async () => root.render(
        <RealFeedCard item={itemFor()} storage={new MemoryVaultStorage()} saved={false} onSave={() => {}} onDismiss={onDismiss} />,
      ))
      if (inMenu) await act(async () => {
        Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Feedback")!.click()
      })
      await act(async () => {
        Array.from(host.querySelectorAll("button")).find((button) => button.getAttribute("aria-label") === label || button.textContent === label)!.click()
      })
      expect(sendRecommendationFeedback).toHaveBeenCalledWith("arxiv:2409.08710", reason)
      expect(onDismiss).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
      expect(host.textContent).toContain("Feedback saved.")
      expect(useCompanionStore.getState().feedbackQuestions).toEqual(reason === "less_like_this"
        ? [{ paperKey: "arxiv:2409.08710", title: "Ear-EEG for Auditory Attention Decoding", revision: "a".repeat(64) }]
        : [])
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })

  it("Dismiss calls onDismiss and does not navigate (footer stops propagation)", async () => {
    const storage = new MemoryVaultStorage()
    const item = itemFor({ tldr: "A tldr.", tags: ["tag-a"] })
    const onDismiss = vi.fn()
    const { host, root } = mount()

    await act(async () => {
      root.render(
        <RealFeedCard item={item} storage={storage} saved={false} onSave={() => {}} onDismiss={onDismiss} />,
      )
    })

    await act(async () => {
      Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Feedback")!.click()
    })
    const dismissButton = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Dismiss")
    expect(dismissButton, "Dismiss button should be present").toBeTruthy()

    await act(async () => {
      dismissButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onDismiss).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("undo it in History"))
    expect(pushMock).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })
})
