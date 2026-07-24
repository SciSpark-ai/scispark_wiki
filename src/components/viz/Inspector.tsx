"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import type { Bundle } from "@/lib/vault/bundle"
import { backlinkCount } from "@/lib/wiki/delete"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref } from "@/lib/wiki/href"

const EXCERPT_LENGTH = 280

interface InspectorProps {
  /** The workspace's FILTERED bundle — neighbor lookups and backlink counts
   * are scoped to whatever the current filters leave visible. */
  bundle: Bundle
  id: string
  /** Page ids adjacent to `id` in the filtered derived graph, computed by
   * the caller (VizWorkspace) from `graph.edges`. */
  neighbors: string[]
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Right-side detail panel for the selected node. Renders `null` if `id`
 * isn't in `bundle` — the caller (VizWorkspace) already gates on this so
 * that's a defensive fallback, not the primary contract.
 *
 * Esc + click-away both call `onClose`, mirroring the listener hygiene
 * pattern in src/components/papers/SaveToProjectMenu.tsx (paired
 * add/remove on every mount — this panel has no separate `open` prop of
 * its own since VizWorkspace only ever mounts it while selected).
 */
export default function Inspector({ bundle, id, neighbors, onSelect, onClose }: InspectorProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  const page = bundle.pages.get(id)
  if (!page) return null

  const fm = page.frontmatter
  const isPaper = fm.type === "paper"
  const slug = page.id.split("/").pop() ?? page.id
  const trimmedBody = page.body.trim()
  const tldr = typeof fm.tldr === "string" ? fm.tldr : ""
  const excerpt =
    trimmedBody.length > EXCERPT_LENGTH ? `${trimmedBody.slice(0, EXCERPT_LENGTH)}…` : trimmedBody
  const bodyPreview = isPaper ? tldr : excerpt
  const backlinks = backlinkCount(bundle, id)

  return (
    <aside ref={ref} className="w-80 shrink-0 overflow-y-auto border-l border-border-warm bg-light-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-heading text-[16px] text-espresso tracking-heading-card">{displayTitle(fm.title)}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="shrink-0 text-[15px] leading-none text-muted-text hover:text-espresso"
        >
          ×
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-card-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-espresso">
          {fm.type}
        </span>
        {fm.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-pill border border-border-warm bg-light-surface px-2 py-0.5 text-[11px] text-muted-text"
          >
            #{tag}
          </span>
        ))}
      </div>

      {bodyPreview && <p className="mt-3 text-[13px] leading-relaxed text-muted-text tracking-body">{bodyPreview}</p>}

      <p className="mt-3 text-[12px] text-muted-text">
        {backlinks} backlink{backlinks === 1 ? "" : "s"}
      </p>

      <div className="mt-4">
        <h3 className="mb-2 text-[12px] font-medium tracking-body text-espresso">Connected</h3>
        {neighbors.length === 0 ? (
          <p className="text-[12px] text-muted-text">No connections in the current view.</p>
        ) : (
          <ul className="space-y-1">
            {neighbors.map((neighborId) => {
              const neighborPage = bundle.pages.get(neighborId)
              return (
                <li key={neighborId}>
                  <button
                    type="button"
                    onClick={() => onSelect(neighborId)}
                    className="w-full truncate text-left text-[13px] text-orange hover:text-orange-light hover:underline"
                  >
                    {displayTitle(neighborPage?.frontmatter.title ?? neighborId)}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-1.5 border-t border-border-warm pt-3">
        <Link href={wikiHref(id)} className="text-[13px] text-orange hover:underline">
          Open wiki page →
        </Link>
        {isPaper && (
          <Link href={`/paper/${slug}`} className="text-[13px] text-orange hover:underline">
            Open paper page →
          </Link>
        )}
      </div>
    </aside>
  )
}
