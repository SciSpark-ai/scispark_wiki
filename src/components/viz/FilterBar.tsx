"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { VizFilterOptions, VizFilters } from "@/lib/viz/filter"
import type { PageType } from "@/lib/vault/types"

// Mirrors the TYPE_HEADINGS/TYPE_DIRS-style label mirrors noted throughout
// the repo (kept in sync manually). GraphView.tsx used to carry its own
// copy for an internal type-filter row; that row was removed (Task 9) once
// this FilterBar became the single type-filtering surface for the whole
// viz workspace, so this is now the only such mirror in this directory.
const TYPE_LABELS: Record<PageType, string> = {
  paper: "Paper",
  concept: "Concept",
  method: "Method",
  finding: "Finding",
  comparison: "Comparison",
  author: "Author",
  topic: "Topic",
  note: "Note",
  query: "Saved answer",
  idea: "Idea",
  project: "Project",
}

interface FilterBarProps {
  options: VizFilterOptions
  filters: VizFilters
  onChange: (filters: VizFilters) => void
}

/** Toolbar filter controls for the viz workspace: type chips, a searchable
 * tag dropdown, and a year-range slider — all derived from `filterOptions`
 * and reported upward as a whole new `VizFilters` via `onChange` (this
 * component holds no filter state of its own, only its transient dropdown
 * open/search-text UI state). */
export function FilterBar({ options, filters, onChange }: FilterBarProps) {
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState("")
  const tagsRef = useRef<HTMLDivElement>(null)

  // Click outside / ESC to close the popover.
  useEffect(() => {
    if (!tagsOpen) return
    const onDown = (e: MouseEvent) => {
      if (!tagsRef.current?.contains(e.target as Node)) setTagsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagsOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [tagsOpen])

  const toggleType = (type: string) => {
    const next = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type]
    onChange({ ...filters, types: next })
  }

  const toggleTag = (tag: string) => {
    const next = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag]
    onChange({ ...filters, tags: next })
  }

  const yearMin = filters.yearRange.min ?? options.yearBounds?.min ?? 0
  const yearMax = filters.yearRange.max ?? options.yearBounds?.max ?? 0

  // Clamp so the range can never invert into a silently-unsatisfiable filter
  // (min dragged past the current max, or vice versa).
  const setYearMin = (value: number) =>
    onChange({ ...filters, yearRange: { ...filters.yearRange, min: Math.min(value, yearMax) } })
  const setYearMax = (value: number) =>
    onChange({ ...filters, yearRange: { ...filters.yearRange, max: Math.max(value, yearMin) } })

  const filteredTags = useMemo(
    () => options.tags.filter((t) => t.toLowerCase().includes(tagQuery.toLowerCase())),
    [options.tags, tagQuery],
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by page type">
        {options.types.map((type) => {
          const active = filters.types.includes(type)
          return (
            <button
              key={type}
              type="button"
              aria-pressed={active}
              onClick={() => toggleType(type)}
              className={`px-2.5 py-1 rounded-pill text-[12px] border transition-colors ${
                active
                  ? "bg-orange text-white border-orange"
                  : "bg-light-surface text-muted-text border-border-warm hover:bg-card-surface"
              }`}
            >
              {TYPE_LABELS[type as PageType] ?? type}
            </button>
          )
        })}
      </div>

      {options.tags.length > 0 && (
        <div className="relative" ref={tagsRef}>
          <button
            type="button"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((v) => !v)}
            className="px-2.5 py-1 rounded-pill text-[12px] border border-border-warm bg-light-surface text-muted-text hover:bg-card-surface transition-colors"
          >
            Tags{filters.tags.length > 0 ? ` (${filters.tags.length})` : ""}
          </button>
          {tagsOpen && (
            <div className="absolute left-0 z-20 mt-1 w-56 rounded-card border border-border-warm bg-light-surface p-2 shadow-lg">
              <input
                type="text"
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                placeholder="Search tags…"
                className="mb-2 w-full rounded-pill border border-border-warm bg-card-surface px-2.5 py-1 text-[12px] text-espresso outline-none"
              />
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {filteredTags.length === 0 ? (
                  <p className="px-1 py-1 text-[12px] text-muted-text">No matching tags.</p>
                ) : (
                  filteredTags.map((tag) => (
                    <label key={tag} className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[12px] text-espresso">
                      <input
                        type="checkbox"
                        checked={filters.tags.includes(tag)}
                        onChange={() => toggleTag(tag)}
                        className="accent-orange"
                      />
                      {tag}
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {options.yearBounds && (
        <div className="flex items-center gap-2 text-[12px] text-muted-text" aria-label="Filter by year range">
          <span>Year</span>
          <input
            type="range"
            min={options.yearBounds.min}
            max={options.yearBounds.max}
            value={yearMin}
            onChange={(e) => setYearMin(Number(e.target.value))}
            className="accent-orange"
            aria-label="Minimum year"
          />
          <span className="tabular-nums text-espresso">{yearMin}</span>
          <span>–</span>
          <input
            type="range"
            min={options.yearBounds.min}
            max={options.yearBounds.max}
            value={yearMax}
            onChange={(e) => setYearMax(Number(e.target.value))}
            className="accent-orange"
            aria-label="Maximum year"
          />
          <span className="tabular-nums text-espresso">{yearMax}</span>
        </div>
      )}
    </div>
  )
}
