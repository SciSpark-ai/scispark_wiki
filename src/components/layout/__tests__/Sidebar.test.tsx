// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/wiki/review-queue", () => ({ reviewCount: async () => 2 }))

import { Sidebar } from "../Sidebar"

const html = () => renderToStaticMarkup(<Sidebar collapsed={false} />)

describe("Sidebar nav map (SP1)", () => {
  it("shows the grouped real-surface map", () => {
    const out = html()
    for (const label of ["Discover", "Knowledge", "Tools", "Home", "Search", "Trending", "Wiki", "Graph", "Projects", "Spark", "Chat", "History"]) {
      expect(out, label).toContain(label)
    }
    for (const href of ["/papers", "/wiki", "/viz", "/spark", "/chat", "/projects", "/trending", "/history"]) {
      expect(out, href).toContain(`href="${href}"`)
    }
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
