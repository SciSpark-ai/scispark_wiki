// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRoot } from "react-dom/client"
import { act } from "react"
import type { Bundle } from "@/lib/vault/bundle"
import type { Frontmatter, WikiPage } from "@/lib/vault/types"

const loadBundleMock = vi.fn()
const reviewCountMock = vi.fn()
let searchParamsValue = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => searchParamsValue,
}))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/vault/bundle", () => ({
  loadBundle: (...args: unknown[]) => loadBundleMock(...args),
}))
vi.mock("@/lib/wiki/review-queue", () => ({
  reviewCount: (...args: unknown[]) => reviewCountMock(...args),
}))

import WikiIndexPage from "../page"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

function bundleFromPages(entries: Array<{ id: string; frontmatter: Frontmatter }>): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, { id: e.id, path: `${e.id}.md`, frontmatter: e.frontmatter, body: "" })
  }
  return { pages, links: [], errors: [] }
}

function smallBundle(): Bundle {
  return bundleFromPages([
    { id: "wiki/papers/saved-one", frontmatter: fm("paper", "Saved Paper One", { status: "saved", updated: "2026-07-20" }) },
    { id: "wiki/papers/enriched-one", frontmatter: fm("paper", "Enriched Paper One", { status: "enriched", updated: "2026-07-19" }) },
    { id: "wiki/papers/ingested-one", frontmatter: fm("paper", "Ingested Paper One", { status: "ingested", updated: "2026-07-18" }) },
    { id: "wiki/concepts/attention", frontmatter: fm("concept", "Attention Mechanism", { updated: "2026-07-17" }) },
    { id: "wiki/notes/idea-note", frontmatter: fm("note", "A quick note", { updated: "2026-07-16" }) },
  ])
}

function emptyBundle(): Bundle {
  return { pages: new Map(), links: [], errors: [] }
}

async function renderPage(): Promise<{ container: HTMLElement; root: ReturnType<typeof createRoot>; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WikiIndexPage />)
  })
  await act(async () => {})
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function clickByText(container: HTMLElement, text: string) {
  const el = Array.from(container.querySelectorAll("button, a")).find((e) => e.textContent?.includes(text))
  if (!el) throw new Error(`no clickable element found containing: ${text}`)
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  searchParamsValue = new URLSearchParams()
  reviewCountMock.mockResolvedValue(3)
})

describe("WikiIndexPage — dashboard default view (SP3 task 3)", () => {
  it("renders the dashboard sections and keeps New note + inbox count in the header", async () => {
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("New note")
    expect(container.textContent).toContain("Review inbox (3)")

    // StatsStrip + shelves + type sections + recent activity
    expect(container.innerHTML).toMatch(/href="\/paper\/saved-one"/)
    expect(container.innerHTML).toMatch(/href="\/paper\/enriched-one"/)
    expect(container.innerHTML).toMatch(/href="\/paper\/ingested-one"/)
    expect(container.textContent).toContain("Attention Mechanism")
    expect(container.textContent).toContain("Saved")
    expect(container.textContent).toContain("Enriched")
    expect(container.textContent).toContain("In knowledge base")

    cleanup()
  })
})

describe("WikiIndexPage — Browse all toggle (SP3 task 3)", () => {
  it("renders the Tree at ?view=all and keeps the header actions", async () => {
    searchParamsValue = new URLSearchParams("view=all")
    loadBundleMock.mockResolvedValue(smallBundle())
    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("New note")
    expect(container.textContent).toContain("Review inbox (3)")

    // Tree groups by type heading and links papers to /paper/<slug>
    expect(container.textContent).toContain("Papers")
    expect(container.textContent).toContain("Concepts")
    expect(container.innerHTML).toMatch(/href="\/paper\/saved-one"/)
    expect(container.innerHTML).toMatch(/href="\/wiki\/concepts\/attention"/)

    cleanup()
  })
})

describe("WikiIndexPage — empty vault (SP3 task 3)", () => {
  it("renders EmptyState with a Search for papers link when there are no pages", async () => {
    loadBundleMock.mockResolvedValue(emptyBundle())
    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("Search for papers")
    expect(container.innerHTML).toMatch(/href="\/papers"/)

    cleanup()
  })
})

describe("WikiIndexPage — shelf View all drill-down (SP3 task 3)", () => {
  it("switches to a full vertical list for the shelf and back again", async () => {
    const manySaved = Array.from({ length: 13 }, (_, i) => ({
      id: `wiki/papers/saved-${i}`,
      frontmatter: fm("paper", `Saved Paper ${i}`, { status: "saved", updated: `2026-07-${String(i + 1).padStart(2, "0")}` }),
    }))
    loadBundleMock.mockResolvedValue(bundleFromPages(manySaved))
    const { container, cleanup } = await renderPage()

    expect(container.textContent).toContain("View all (13)")

    clickByText(container, "View all (13)")

    // all 13 saved papers now visible, plus a back-to-dashboard affordance
    for (let i = 0; i < 13; i++) {
      expect(container.innerHTML).toMatch(new RegExp(`href="/paper/saved-${i}"`))
    }
    expect(container.textContent).toContain("Back to dashboard")

    clickByText(container, "Back to dashboard")

    // the shelf strip (capped, no longer a full list) is back
    expect(container.textContent).toContain("Saved")
    expect(container.textContent).not.toContain("Back to dashboard")

    cleanup()
  })
})
