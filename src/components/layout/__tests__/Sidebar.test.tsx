// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("next/navigation", () => ({ usePathname: () => "/" }))

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
