"use client"

import { useEffect, useMemo, useRef } from "react"
import { useUIStore } from "@/stores/ui-store"
import { ConnectAiCard } from "./ConnectAiCard"
import { CompanionCard } from "./CompanionCard"
import { SpendPanel } from "./SpendPanel"
import { AppearanceCard } from "./AppearanceCard"
import { TrendingFieldsCard } from "./TrendingFieldsCard"
import { RecommendationCard } from "./RecommendationCard"
import { cn } from "@/components/ui/cn"

const SECTIONS = [
  { id: "ai", label: "Connect your AI", body: <ConnectAiCard /> },
  { id: "spend", label: "Spend & budget", body: <SpendPanel /> },
  { id: "companion", label: "Companion", body: <CompanionCard /> },
  { id: "appearance", label: "Appearance", body: <AppearanceCard /> },
  { id: "trending", label: "Trending fields", body: <TrendingFieldsCard /> },
  { id: "recommendations", label: "Recommendations", body: <RecommendationCard /> },
] as const

export default function SettingsModal() {
  const section = useUIStore((s) => s.settingsModalSection)
  const close = useUIStore((s) => s.closeSettingsModal)
  const open = useUIStore((s) => s.openSettingsModal)

  const active = useMemo(() => SECTIONS.find((s) => s.id === section) ?? SECTIONS[0], [section])
  const dialogRef = useRef<HTMLDivElement>(null)
  const isOpen = section !== null

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen) return
    dialogRef.current?.focus()
  }, [isOpen])

  if (section === null) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Settings"
        tabIndex={-1}
        className="flex h-[min(640px,90vh)] w-[min(880px,95vw)] flex-col overflow-hidden rounded-card border border-border-warm bg-page-bg shadow-xl sm:flex-row"
      >
        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-warm bg-light-surface p-3 sm:block sm:w-52 sm:border-b-0 sm:border-r">
          <div className="hidden px-2 pb-2 text-[11px] uppercase tracking-wide text-muted-text sm:block">Settings</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => open(s.id)}
              className={cn(
                "block shrink-0 rounded-btn px-3 py-2 text-left text-[13px] sm:w-full",
                s.id === active.id ? "bg-card-surface text-espresso" : "text-secondary-dark hover:bg-card-surface/60",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex items-start justify-end">
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
