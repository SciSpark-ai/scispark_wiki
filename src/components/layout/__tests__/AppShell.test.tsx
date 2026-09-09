// @vitest-environment jsdom
import { act, useEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

const route = vi.hoisted(() => ({ pathname: "/chat" }))
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }))
vi.mock("framer-motion", () => ({
  motion: { div: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/stores/ui-store", () => ({ useUIStore: (select: (state: object) => unknown) => select({ desktopSidebarOpen: true, showRightPanel: false, rightPanelContent: null }) }))
vi.mock("../Sidebar", () => ({ Sidebar: () => null }))
vi.mock("../MobileNav", () => ({ MobileNav: () => null }))
vi.mock("../RightPanel", () => ({ RightPanel: () => null }))
vi.mock("../ThemeApplier", () => ({ default: () => null }))
vi.mock("../NavHistoryTracker", () => ({ default: () => null }))
vi.mock("../UserIdentityHydrator", () => ({ UserIdentityHydrator: () => null }))
vi.mock("@/components/notes/SelectionToNoteBubble", () => ({ SelectionToNoteBubble: () => null }))
vi.mock("@/components/companion/CompanionMascot", () => ({ CompanionMascot: () => null }))
vi.mock("@/components/settings/SettingsModal", () => ({ default: () => null }))
vi.mock("@/components/projects/LegacyPrototypeWarning", () => ({ LegacyPrototypeWarning: () => null }))

import { AppShell } from "../AppShell"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("App Router page ownership", () => {
  it.each([["/chat", "/chat/chat_fixture"], ["/trending", "/paper/fixture"], ["/onboarding", "/setup"]])(
    "does not remount destination content when pathname catches up: %s -> %s",
    async (from, to) => {
      const mounts = vi.fn()
      function DestinationPage() {
        const [draft, setDraft] = useState(false)
        useEffect(() => { mounts() }, [])
        return <button onClick={() => setDraft(true)}>{draft ? "Unsaved input" : "Empty"}</button>
      }
      const container = document.createElement("div")
      const root = createRoot(container)
      try {
        // Next can replace children before usePathname updates. The shell must
        // not give those same destination children a new key on that update.
        route.pathname = from
        await act(async () => root.render(<AppShell><DestinationPage /></AppShell>))
        await act(async () => container.querySelector("button")!.click())
        route.pathname = to
        await act(async () => root.render(<AppShell><DestinationPage /></AppShell>))
        expect(container.textContent).toContain("Unsaved input")
        expect(mounts).toHaveBeenCalledTimes(1)
      } finally {
        await act(async () => root.unmount())
      }
    },
  )
})
