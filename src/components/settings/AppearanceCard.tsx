"use client"

import { useEffect, useState } from "react"
import { applyTheme, loadUiSettingsRemote, saveUiSettingsRemote } from "@/lib/ui/settings-client"
import type { ThemeMode } from "@/lib/ui/settings"
import { Button } from "@/components/ui/Button"

const MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
]

export function AppearanceCard() {
  const [mode, setMode] = useState<ThemeMode>("system")

  useEffect(() => {
    void loadUiSettingsRemote().then((ui) => setMode(ui.theme))
  }, [])

  async function choose(next: ThemeMode) {
    setMode(next)
    applyTheme(next)
    try {
      await saveUiSettingsRemote({ theme: next })
    } catch {
      // theme already applied locally; persistence failure is non-fatal
    }
  }

  return (
    <div>
      <h3 className="font-heading text-[16px] text-espresso tracking-heading-card">Theme</h3>
      <p className="mt-1 text-[12px] text-muted-text">How SciSpark looks on this machine.</p>
      <div className="mt-3 flex gap-2">
        {MODES.map((m) => (
          <Button key={m.value} variant={mode === m.value ? "primary" : "secondary"} onClick={() => void choose(m.value)}>
            {m.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
