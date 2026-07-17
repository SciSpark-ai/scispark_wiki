"use client"

import { useEffect } from "react"
import { loadUiSettingsRemote, applyTheme } from "@/lib/ui/settings-client"
import type { ThemeMode } from "@/lib/ui/settings"

/** Syncs the persisted theme mode on mount and follows OS changes in
 * "system" mode. Renders nothing. */
export default function ThemeApplier() {
  useEffect(() => {
    let mode: ThemeMode = "system"
    let cancelled = false
    void loadUiSettingsRemote().then((ui) => {
      if (cancelled) return
      mode = ui.theme
      applyTheme(mode)
    })
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      // Re-read the mode from the localStorage mirror rather than the
      // closed-over `mode` above — AppearanceCard can call applyTheme()
      // directly after mount, and this handler's stale closure would keep
      // treating the mode as whatever it was when the effect first ran,
      // clobbering a later explicit light/dark choice on the next OS flip.
      let current: ThemeMode = "system"
      try {
        const stored = localStorage.getItem("scispark-theme")
        if (stored === "light" || stored === "dark" || stored === "system") current = stored
      } catch {
        // storage unavailable — treat as "system"
      }
      if (current === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    return () => {
      cancelled = true
      media.removeEventListener("change", onChange)
    }
  }, [])
  return null
}
