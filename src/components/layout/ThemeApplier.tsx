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
      if (mode === "system") applyTheme("system")
    }
    media.addEventListener("change", onChange)
    return () => {
      cancelled = true
      media.removeEventListener("change", onChange)
    }
  }, [])
  return null
}
