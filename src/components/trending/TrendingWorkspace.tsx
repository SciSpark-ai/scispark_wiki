"use client"

import { useState } from "react"
import type { TrendingBoard } from "@/lib/trending/types"
import { openAlexSubfield } from "@/lib/trending/openalex-subfields"
import { Leaderboard } from "./Leaderboard"
import { BreakoutPapers } from "./BreakoutPapers"

/** Presentation-only filters: no requests, preference writes or re-ranking. */
export function TrendingWorkspace({ board }: { board: TrendingBoard }) {
  const [field, setField] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const selected = board.anchors.find((anchor) => anchor.id === field)
  const topics = selected ? board.topics.filter((topic) => topic.discipline === selected.label) : board.topics
  const scopes = selected ? [selected] : board.anchors
  function chooseField(id: string | null) { setField(id); setExpandedKey(null) }

  return (
    <div className="mt-4 sm:mt-6">
      <div role="group" aria-label="Filter topics by field" className="flex flex-wrap gap-2">
        {[{ id: null, label: "All fields" }, ...board.anchors].map((anchor) => (
          <button key={anchor.id ?? "all"} type="button" aria-pressed={anchor.id === (selected?.id ?? null)}
            onClick={() => chooseField(anchor.id)}
            className={`rounded-btn border px-4 py-2.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange ${anchor.id === (selected?.id ?? null) ? "border-espresso bg-espresso text-page-bg" : "border-border-warm text-secondary-dark hover:bg-card-surface"}`}>
            {anchor.label}
          </button>
        ))}
      </div>
      {scopes.length > 0 && (
        <details className="mt-3 text-[12px] text-secondary-dark" key={selected?.id ?? "all"}>
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-orange">
            {selected ? "Included subfields" : "Fields and subfields included"}
          </summary>
          <dl className="mt-2 grid gap-3 rounded-btn bg-light-surface p-4">
            {scopes.map((anchor) => (
              <div key={anchor.id} className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <dt className="font-medium text-espresso">{anchor.label}</dt>
                <dd className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 leading-relaxed">
                  {anchor.subfieldIds?.length ? anchor.subfieldIds.map((id) => (
                    <span key={id}>{openAlexSubfield(id)?.label ?? "Unrecognized subfield"}</span>
                  )) : "Entire field"}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className={`mt-5 grid min-w-0 items-start gap-8 sm:mt-7 ${board.breakouts.length ? "xl:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}>
        <section aria-labelledby="trending-topics-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="trending-topics-heading" className="font-heading text-[24px] text-espresso tracking-heading-card">Topic activity</h2>
            <span className="text-[12px] text-muted-text">{topics.length} {topics.length === 1 ? "topic" : "topics"} in this selection</span>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-secondary-dark">
            <span className="inline-block">Growth tracks publication share.</span>{" "}
            <span className="inline-block">It does not measure paper-count growth.</span>
          </p>
          {selected && !topics.length && board.topics.length > 0 ? (
            <div role="status" className="rounded-btn border border-dashed border-border-warm p-6">
              <h3 className="text-[15px] font-medium text-espresso">No {selected.label} topics in this ranked selection</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary-dark">This update shows the top {board.topics.length} topics across your fields. It does not mean this field has no activity.</p>
              {board.dataError && <p className="mt-2 text-[13px] text-secondary-dark">Some activity data is also unavailable for this update.</p>}
              <button type="button" onClick={() => chooseField(null)} className="mt-4 rounded text-[13px] font-medium text-orange underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-orange">Show all topics</button>
            </div>
          ) : (
            <Leaderboard board={{ ...board, topics }} expandedKey={expandedKey} onToggle={(key) => setExpandedKey((current) => current === key ? null : key)} />
          )}
          <details className="mt-4 text-[12px] leading-relaxed text-muted-text">
            <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-orange">How to read these trends</summary>
            <p className="mt-2">Growth compares the two publication windows shown above, within each field’s selected scope. A large percentage can start from a small baseline. “New” means earlier activity is too limited for a reliable comparison.</p>
            <p className="mt-2">OpenAlex indexing can lag behind publication. Counts may change as more papers are indexed. Matching your interests is a topic signal, not a judgment of research quality.</p>
          </details>
        </section>
        {board.breakouts.length > 0 && <aside aria-label="Highly cited papers across all fields" className="min-w-0 border-t border-border-warm pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
          <BreakoutPapers breakouts={board.breakouts} generatedAt={board.generatedAt} />
        </aside>}
      </div>
    </div>
  )
}
