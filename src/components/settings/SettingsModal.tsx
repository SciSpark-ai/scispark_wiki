"use client"

import { useMemo } from "react"
import { useUIStore } from "@/stores/ui-store"
import { ConnectAiCard } from "./ConnectAiCard"
import { CompanionCard } from "./CompanionCard"
import { SpendPanel } from "./SpendPanel"
import { AppearanceCard } from "./AppearanceCard"
import { TrendingFieldsCard } from "./TrendingFieldsCard"
import { cn } from "@/components/ui/cn"

const SECTIONS = [
  { id: "ai", label: "Connect your AI", body: <ConnectAiCard /> },
  { id: "spend", label: "Spend & budget", body: <SpendPanel /> },
  { id: "companion", label: "Companion", body: <CompanionCard /> },
  { id: "appearance", label: "Appearance", body: <AppearanceCard /> },
  { id: "trending", label: "Trending fields", body: <TrendingFieldsCard /> },
] as const

export default function SettingsModal() {
  const section = useUIStore((s) => s.settingsModalSection)
  const close = useUIStore((s) => s.closeSettingsModal)
  const open = useUIStore((s) => s.openSettingsModal)

  const active = useMemo(() => SECTIONS.find((s) => s.id === section) ?? SECTIONS[0], [section])
  if (section === null) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[min(640px,90vh)] w-[min(880px,95vw)] overflow-hidden rounded-card border border-border-warm bg-page-bg shadow-xl"
        onKeyDown={(e) => {
          if (e.key === "Escape") close()
        }}
      >
        <nav className="w-52 shrink-0 border-r border-border-warm bg-light-surface p-3">
          <div className="px-2 pb-2 text-[11px] uppercase tracking-wide text-muted-text">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => open(s.id)}
              className={cn(
                "block w-full rounded-btn px-3 py-2 text-left text-[13px]",
                s.id === active.id ? "bg-card-surface text-espresso" : "text-secondary-dark hover:bg-card-surface/60",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-start justify-between">
            <h2 className="font-heading text-[20px] text-espresso tracking-heading-card">{active.label}</h2>
            <button type="button" onClick={close} aria-label="Close settings" className="text-muted-text hover:text-espresso">
              ✕
            </button>
          </div>
          <div className="mt-4">{active.body}</div>
        </div>
      </div>
    </div>
  )
}
