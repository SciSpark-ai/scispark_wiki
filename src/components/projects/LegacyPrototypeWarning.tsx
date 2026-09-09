"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, X } from "lucide-react"
import {
  clearLegacyPrototypeData,
  detectLegacyPrototypeData,
  markLegacyPrototypeWarningSeen,
} from "@/lib/projects/legacy-data"

export function LegacyPrototypeWarning() {
  const [keys, setKeys] = useState<string[]>([])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeys(detectLegacyPrototypeData(window.localStorage))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  if (keys.length === 0) return null

  return (
    <aside
      role="status"
      className="fixed bottom-5 left-1/2 z-[80] w-[min(92vw,620px)] -translate-x-1/2 rounded-card border border-border-warm bg-light-surface p-4 shadow-lg"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-accent-ink" size={18} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-espresso">Prototype browser data found</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-text">
            Older mock projects, notes, or paper actions cannot be migrated into your real vault.
            Keeping them does not affect the new project data.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                clearLegacyPrototypeData(window.localStorage)
                setKeys([])
              }}
              className="rounded-pill bg-orange px-3 py-1.5 text-[12px] font-medium text-on-accent hover:bg-orange/90"
            >
              Delete prototype data
            </button>
            <button
              type="button"
              onClick={() => {
                markLegacyPrototypeWarningSeen(window.localStorage)
                setKeys([])
              }}
              className="rounded-pill border border-border-warm px-3 py-1.5 text-[12px] font-medium text-espresso hover:bg-page-warm"
            >
              Keep it
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Keep prototype data and dismiss warning"
          onClick={() => {
            markLegacyPrototypeWarningSeen(window.localStorage)
            setKeys([])
          }}
          className="rounded-[6px] p-1 text-muted-text hover:bg-page-warm hover:text-espresso"
        >
          <X size={16} />
        </button>
      </div>
    </aside>
  )
}
