"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { cn } from "@/components/ui/cn"
import { applyTheme, loadUiSettingsRemote, saveUiSettingsRemote } from "@/lib/ui/settings-client"
import type { ThemeMode } from "@/lib/ui/settings"

function documentIsDark(): boolean {
  return document.documentElement.dataset.theme === "dark"
}

/** A one-click, always-visible light/dark control. The full System/Light/Dark
 * choice remains available in Appearance settings; this button resolves
 * System to the current appearance and flips it explicitly. */
export function ThemeToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("system")
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    void loadUiSettingsRemote().then((ui) => {
      setMode(ui.theme)
      applyTheme(ui.theme)
      setIsDark(documentIsDark())
    })
  }, [])

  async function toggleTheme() {
    const next: ThemeMode = documentIsDark() ? "light" : "dark"
    setMode(next)
    applyTheme(next)
    setIsDark(next === "dark")
    try {
      await saveUiSettingsRemote({ theme: next })
    } catch {
      // The visual change is already applied locally. A transient persistence
      // failure should not make the theme button feel broken.
    }
  }

  const nextLabel = isDark ? "light" : "dark"

  return (
    <button
      type="button"
      onClick={() => void toggleTheme()}
      aria-label={`Switch to ${nextLabel} mode`}
      title={`Switch to ${nextLabel} mode`}
      data-theme-mode={mode}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-warm bg-light-surface text-espresso transition-colors hover:border-orange/50 hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink",
        className,
      )}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  )
}
