// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/wiki/review-queue", () => ({ reviewCount: async () => 2 }))

const listSessionsMock = vi.fn(async (vault: unknown) => {
  void vault
  return [] as Array<{ id: string; title: string }>
})
vi.mock("@/lib/chat/session", () => ({
  listSessions: (vault: unknown) => listSessionsMock(vault),
}))

import { Sidebar } from "../Sidebar"

const html = () => renderToStaticMarkup(<Sidebar collapsed={false} />)

describe("Sidebar nav map (SP1)", () => {
  it("shows the grouped real-surface map", () => {
    const out = html()
    for (const label of ["Discover", "Knowledge", "Tools", "Home", "Sparky", "Trending", "Wiki", "Graph", "Projects", "Spark", "History"]) {
      expect(out, label).toContain(label)
    }
    for (const href of ["/wiki", "/viz", "/spark", "/chat", "/projects", "/trending", "/history"]) {
      expect(out, href).toContain(`href="${href}"`)
    }
    expect(out).not.toContain('href="/papers"')
  })
  it("drops the fork-era items and settings from the rail", () => {
    const out = html()
    expect(out).not.toContain("New Chat")
    expect(out).not.toContain("Library")
    expect(out).not.toContain("Recent Chats")
    expect(out).not.toContain('href="/settings"')
    expect(out).not.toContain("Dashboard")
  })
})

describe("Sidebar recent chats (SP5 Task 10)", () => {
  async function renderMounted() {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<Sidebar collapsed={false} />)
    })
    await act(async () => {})
    return { container, root }
  }

  it("renders the most recent sessions newest-first, each linking to its session", async () => {
    listSessionsMock.mockResolvedValueOnce([
      { id: "chat_2", title: "Second question about diffusion models" },
      { id: "chat_1", title: "First question about transformers" },
    ])

    const { container, root } = await renderMounted()

    const html = container.innerHTML
    const idx2 = html.indexOf('href="/chat/chat_2"')
    const idx1 = html.indexOf('href="/chat/chat_1"')
    expect(idx2).toBeGreaterThan(-1)
    expect(idx1).toBeGreaterThan(-1)
    expect(idx2).toBeLessThan(idx1)
    expect(html).toContain("Second question about diffusion models")
    expect(html).toContain("First question about transformers")

    act(() => root.unmount())
    container.remove()
  })

  it("renders nothing extra when there are no sessions", async () => {
    listSessionsMock.mockResolvedValueOnce([])

    const { container, root } = await renderMounted()

    expect(container.innerHTML).not.toContain("/chat/chat_")

    act(() => root.unmount())
    container.remove()
  })

  it("does not render mock/hardcoded chat data — only what listSessions returns", async () => {
    listSessionsMock.mockResolvedValueOnce([{ id: "chat_9", title: "A real vault session" }])

    const { container, root } = await renderMounted()

    const html = container.innerHTML
    expect(html).toContain("A real vault session")
    expect(html).not.toContain("Compare treatments")
    expect(html).not.toContain("Summarize RCT")
    expect(html).not.toContain("No conversations yet")

    act(() => root.unmount())
    container.remove()
  })
})

describe("Sidebar review-inbox badge (SP1)", () => {
  it("renders the review count badge on the Wiki nav item once loaded", async () => {
    ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<Sidebar collapsed={false} />)
    })
    await act(async () => {})

    expect(container.innerHTML).toContain(">2<")

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
