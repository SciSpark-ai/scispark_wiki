// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { TrendingBoard } from "@/lib/trending/dashboard"
import type { TrendingSettings } from "@/lib/trending/settings"
import type { PaperRecord } from "@/lib/papers/types"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getOpenVaultMock = vi.fn()
const readUserModelMock = vi.fn()
const loadTrendingSettingsRemoteMock = vi.fn()
const loadBoardMock = vi.fn()
const isStaleMock = vi.fn()
const anchorsMatchBoardMock = vi.fn()
const refreshTrendingDashboardMock = vi.fn()
const openSettingsModalMock = vi.fn()

vi.mock("@/lib/vault/get-vault", () => ({
  getOpenVault: (...args: unknown[]) => getOpenVaultMock(...args),
}))
vi.mock("@/lib/usermodel/pages", () => ({
  readUserModel: (...args: unknown[]) => readUserModelMock(...args),
}))
vi.mock("@/lib/trending/settings-client", () => ({
  loadTrendingSettingsRemote: (...args: unknown[]) => loadTrendingSettingsRemoteMock(...args),
}))
// No `vi.importActual` here — that pulls in the real module (which imports
// `runSkill`/providers) via a dynamic import the browser-purity gate treats
// as exposing every named export, including the banned `runTrendingBoard`.
// The page only needs these three functions plus the `TrendingBoard` type
// (type-only, erased at compile time), so mock them directly.
vi.mock("@/lib/trending/dashboard", () => ({
  loadBoard: (...args: unknown[]) => loadBoardMock(...args),
  isStale: (...args: unknown[]) => isStaleMock(...args),
  anchorsMatchBoard: (...args: unknown[]) => anchorsMatchBoardMock(...args),
}))
vi.mock("@/lib/trending/client", () => ({
  refreshTrendingDashboard: (...args: unknown[]) => refreshTrendingDashboardMock(...args),
}))
vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (s: { openSettingsModal: typeof openSettingsModalMock }) => unknown) =>
    selector({ openSettingsModal: openSettingsModalMock }),
}))

import TrendingPage from "../page"

function paper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: { arxiv: "2409.08710" },
    title: "Sparse Attention for Long Sequences",
    authors: [{ name: "A. Researcher" }],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

function board(overrides: Partial<TrendingBoard> = {}): TrendingBoard {
  return {
    version: 2,
    anchors: [{ id: "machine-learning", label: "Machine Learning" }],
    overview: {
      totalRecent: 128,
      topTopicLabel: "Sparse Attention",
      topTopicGrowth: 1,
      relevantCount: 1,
    },
    topics: [
      {
        key: "sparse-attention",
        label: "Sparse Attention",
        discipline: "Machine Learning",
        growth: 1,
        recentCount: 42,
        weekly: [],
        papers: [{ record: paper(), wikiPageId: null }],
        why: "Several groups converged on sub-quadratic attention this quarter.",
        relevant: true,
      },
      {
        key: "diffusion-priors",
        label: "Diffusion Priors",
        discipline: "Machine Learning",
        growth: 0.5,
        recentCount: 20,
        weekly: [],
        papers: [{ record: paper({ title: "Diffusion Priors for Inverse Problems" }), wikiPageId: null }],
        why: "A second cluster of work on learned priors.",
        relevant: false,
      },
    ],
    breakouts: [],
    crossDisciplineNote: null,
    generatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  }
}

function trendingSettings(overrides: Partial<TrendingSettings> = {}): TrendingSettings {
  return {
    fields: [{ slug: "machine-learning", label: "Machine Learning" }],
    cadence: "weekly",
    anchors: [{ id: "machine-learning", label: "Machine Learning" }],
    anchorsOverridden: false,
    ...overrides,
  }
}

async function renderPage(): Promise<{ container: HTMLElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<TrendingPage />)
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return {
    container,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function clickByText(container: HTMLElement, text: string) {
  const el = Array.from(container.querySelectorAll("button, a")).find((e) => e.textContent?.trim() === text)
  if (!el) throw new Error(`no clickable element found containing: ${text}`)
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

/** Clicks the leaderboard row's toggle button (its full text is rank + badge + label + discipline, not just the label). */
function clickTopicRow(container: HTMLElement, label: string) {
  const el = Array.from(container.querySelectorAll('button[aria-expanded]')).find((e) =>
    e.textContent?.includes(label),
  )
  if (!el) throw new Error(`no topic row found for: ${label}`)
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getOpenVaultMock.mockResolvedValue({})
  readUserModelMock.mockResolvedValue({ profile: null, interests: null, feedback: null })
  loadTrendingSettingsRemoteMock.mockResolvedValue(trendingSettings())
  isStaleMock.mockReturnValue(false)
  anchorsMatchBoardMock.mockReturnValue(true)
  loadBoardMock.mockResolvedValue(null)
  refreshTrendingDashboardMock.mockResolvedValue(board())
})

describe("TrendingPage — ready board (SP4 Task 9)", () => {
  it("renders the overview strip and leaderboard from a fresh cached board, without refreshing", async () => {
    loadBoardMock.mockResolvedValue(board())
    isStaleMock.mockReturnValue(false)
    anchorsMatchBoardMock.mockReturnValue(true)

    const { container, cleanup } = await renderPage()

    // OverviewStrip figures
    expect(container.textContent).toContain("128")
    expect(container.textContent).toContain("Sparse Attention")
    expect(container.textContent).toContain("relevant to you")

    // Leaderboard rows
    expect(container.textContent).toContain("Diffusion Priors")
    expect(container.textContent).toContain("+100%")

    // Fresh board: no background refresh fired
    expect(refreshTrendingDashboardMock).not.toHaveBeenCalled()

    cleanup()
  })

  it("shows anchor-discipline chips in the header that open the settings modal's trending section", async () => {
    loadBoardMock.mockResolvedValue(board())

    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("Machine Learning")
    clickByText(container, "Machine Learning")
    expect(openSettingsModalMock).toHaveBeenCalledWith("trending")

    cleanup()
  })

  it("expands only one leaderboard row at a time", async () => {
    loadBoardMock.mockResolvedValue(board())

    const { container, cleanup } = await renderPage()

    expect(container.textContent).not.toContain("Several groups converged on sub-quadratic attention")
    expect(container.textContent).not.toContain("A second cluster of work on learned priors")

    clickTopicRow(container, "Sparse Attention")
    expect(container.textContent).toContain("Several groups converged on sub-quadratic attention")
    expect(container.textContent).not.toContain("A second cluster of work on learned priors")

    clickTopicRow(container, "Diffusion Priors")
    expect(container.textContent).not.toContain("Several groups converged on sub-quadratic attention")
    expect(container.textContent).toContain("A second cluster of work on learned priors")

    cleanup()
  })
})

describe("TrendingPage — empty state (SP4 Task 9)", () => {
  it("points at settings when there are no interest labels", async () => {
    loadTrendingSettingsRemoteMock.mockResolvedValue(trendingSettings({ fields: [] }))
    readUserModelMock.mockResolvedValue({ profile: null, interests: null, feedback: null })
    loadBoardMock.mockResolvedValue(null)

    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("No tracked fields yet")
    expect(container.innerHTML).toMatch(/href="\/profile"/)

    cleanup()
  })
})

describe("TrendingPage — anchors-changed scope mismatch (SP4 Task 9)", () => {
  it("goes through the loading path instead of rendering a board built for different anchors", async () => {
    // A cached board for one set of anchors, current settings scoped to a
    // different (non-empty) anchor set: anchorsMatchBoard says false, so the
    // mismatched cached board must never render — the page should await a
    // fresh refresh instead of showing content built for the wrong anchors.
    const staleAnchorBoard = board({ anchors: [{ id: "old-field", label: "Old Field" }] })
    loadBoardMock.mockResolvedValue(staleAnchorBoard)
    anchorsMatchBoardMock.mockReturnValue(false)
    loadTrendingSettingsRemoteMock.mockResolvedValue(
      trendingSettings({ anchors: [{ id: "machine-learning", label: "Machine Learning" }] }),
    )
    // Never resolves — keeps the page in the loading path for the assertion.
    refreshTrendingDashboardMock.mockReturnValue(new Promise(() => {}))

    const { container, cleanup } = await renderPage()

    expect(container.textContent).not.toContain("Old Field")
    expect(container.textContent).not.toContain("Sparse Attention")
    expect(container.textContent).toMatch(/Loading|Gathering/)
    expect(refreshTrendingDashboardMock).toHaveBeenCalled()

    cleanup()
  })
})

describe("TrendingPage — surveyError (SP4 Task 9)", () => {
  it("surfaces a surveyError without hiding the ranking", async () => {
    loadBoardMock.mockResolvedValue(board({ surveyError: "Machine Learning: LLM call timed out" }))
    isStaleMock.mockReturnValue(false)
    anchorsMatchBoardMock.mockReturnValue(true)

    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("LLM call timed out")
    // ranking still visible
    expect(container.textContent).toContain("Sparse Attention")
    expect(container.textContent).toContain("Diffusion Priors")

    cleanup()
  })
})
