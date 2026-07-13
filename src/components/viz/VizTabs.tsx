"use client"

export type VizTab = "graph" | "timeline" | "citations" | "authors"

const TABS: { value: VizTab; label: string }[] = [
  { value: "graph", label: "Graph" },
  { value: "timeline", label: "Timeline" },
  { value: "citations", label: "Citations" },
  { value: "authors", label: "Authors" },
]

interface VizTabsProps {
  active: VizTab
  onChange: (tab: VizTab) => void
}

/** The dashboard's Graph|Timeline|Citations|Authors tab bar, styled as the
 * app's pill toggles (mirrors the specialty-filter chips in FeedTabs). */
export function VizTabs({ active, onChange }: VizTabsProps) {
  return (
    <div className="flex gap-2" role="tablist" aria-label="Dashboard views">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-4 py-1.5 rounded-pill text-[13px] font-medium border transition-colors ${
            active === tab.value
              ? "bg-orange text-white border-orange"
              : "bg-light-surface text-muted-text border-border-warm hover:bg-card-surface"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
