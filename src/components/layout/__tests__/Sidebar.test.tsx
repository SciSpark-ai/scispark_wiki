// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoot } from "react-dom/client"
import { act } from "react"

vi.mock("@/lib/extensions/client", () => ({ listToolsRemote: async () => ({ tools: [] }), toolHref: () => "/chat" }))
vi.mock("next/navigation", () => ({ usePathname: () => "/" }))
vi.mock("@/lib/vault/get-vault", () => ({ getOpenVault: async () => ({}) }))
vi.mock("@/lib/wiki/review-queue", () => ({ reviewCount: async () => 2 }))

const listSessionsMock = vi.fn(async (vault: unknown) => {
  void vault
  return [] as Array<{ id: string; title: string; createdAt?: string }>
})
vi.mock("@/lib/chat/session", () => ({
  listSessions: (vault: unknown) => listSessionsMock(vault),
}))

import { Sidebar } from "../Sidebar"
import { MobileNav } from "../MobileNav"
import { useUIStore } from "@/stores/ui-store"

const html = () => renderToStaticMarkup(<Sidebar collapsed={false} />)

describe("Sidebar nav map (SP1)", () => {
  it("shows the grouped real-surface map", () => {
    const out = html()
    for (const label of ["Discover", "Knowledge", "Tools", "Home", "Sparky", "Wiki", "Graph", "Projects", "History"]) {
      expect(out, label).toContain(label)
    }
    for (const href of ["/wiki", "/viz", "/tools", "/chat", "/projects", "/history"]) {
      expect(out, href).toContain(`href="${href}"`)
    }
    expect(out).not.toContain('href="/papers"')
    expect(out).not.toContain('href="/trending"')
    expect(out).not.toContain('href="/spark"')
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
    // Saved conversations are shortcuts within History, not tool children.
    expect(html.indexOf('href="/history"')).toBeLessThan(idx2)
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

  it("distinguishes repeated titles with visible creation times", async () => {
    listSessionsMock.mockResolvedValueOnce([
      { id: "chat_2", title: "The same long question…", createdAt: "2026-09-29T07:50:00Z" },
      { id: "chat_1", title: "The same long question…", createdAt: "2026-09-29T07:49:00Z" },
    ])
    const { container, root } = await renderMounted()
    const times = [...container.querySelectorAll("time")]
    expect(times).toHaveLength(2)
    expect(times[0].textContent).not.toEqual(times[1].textContent)
    expect(times[0].dateTime).toBe("2026-09-29T07:50:00Z")
    act(() => root.unmount()); container.remove()
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

it("closes the mobile drawer on destination selection and omits desktop header controls", async () => {
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  vi.stubGlobal("matchMedia", vi.fn(() => media))
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<MobileNav />))
  await act(async () => (host.querySelector('[aria-label="Open menu"]') as HTMLButtonElement).click())
  const dialog = host.querySelector('[role="dialog"]')!
  expect(dialog.querySelector('[aria-label="Close menu"]')).not.toBeNull()
  expect(dialog.querySelector('[aria-label="Close sidebar"]')).toBeNull()
  expect(dialog.querySelector('[aria-label="Switch to dark mode"]')).toBeNull()
  const link = dialog.querySelector('a[href="/"]') as HTMLAnchorElement
  link.addEventListener("click", (event) => event.preventDefault())
  await act(async () => link.click())
  expect(useUIStore.getState().sidebarOpen).toBe(false)
  await act(async () => (host.querySelector('[aria-label="Open menu"]') as HTMLButtonElement).click())
  await act(async () => { media.matches = true; listeners.forEach((listener) => listener()) })
  expect(useUIStore.getState().sidebarOpen).toBe(false)
  expect(host.querySelector('[aria-label="Open menu"]')!.closest('[inert]')).toBeNull()
  act(() => root.unmount()); host.remove()
  expect(listeners.size).toBe(0)
  vi.unstubAllGlobals()
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
