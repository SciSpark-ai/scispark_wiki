"use client"

import Link from "next/link"
import type { Seed } from "@/lib/spark/quick"
import { formatGroundingCount } from "@/lib/spark/ui-format"

export type SeedSaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; pageId: string } // bare wiki id, e.g. "wiki/ideas/idea-foo" (no ".md")
  | { status: "error"; message: string }

/** wiki page id -> the /wiki/<...> route (same idiom every gallery page in
 * this repo defines locally — see src/app/papers/page.tsx, src/app/wiki/inbox/page.tsx). */
function pageHref(id: string): string {
  return `/wiki/${id}`
}

interface SeedCardProps {
  seed: Seed
  saveState: SeedSaveState
  onSave: () => void
  onDevelop: () => void
  /** True while this specific seed is running through Deep Spark ("Develop fully"). */
  developBusy: boolean
}

/**
 * One Quick Spark seed — companion-conversation-light styling (a soft card in
 * the page body, borrowing CompanionBubble's card language — border-border-warm
 * / bg-light-surface / rounded-card — without its dismiss/mascot chrome, since
 * this lives inline on /spark rather than in the floating mascot bubble).
 */
export function SeedCard({ seed, saveState, onSave, onDevelop, developBusy }: SeedCardProps) {
  return (
    <div className="border border-border-warm rounded-card px-4 py-3 bg-light-surface">
      <h3 className="font-heading text-[16px] text-espresso tracking-heading-card">{seed.title}</h3>
      <p className="mt-1 text-[13px]/[18px] text-espresso">{seed.hook}</p>
      <p className="mt-2 text-[13px]/[18px] text-muted-text">{seed.rationale}</p>

      <div className="mt-2 text-[12px] text-muted-text tracking-body">
        {formatGroundingCount(seed.groundingPageIds.length)}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {saveState.status === "saved" ? (
          <Link
            href={pageHref(saveState.pageId)}
            className="text-[13px] text-orange hover:text-orange-light font-medium"
          >
            View idea page →
          </Link>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={saveState.status === "saving"}
            className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1 disabled:opacity-50"
          >
            {saveState.status === "saving" ? "Saving…" : "Save"}
          </button>
        )}
        <button
          type="button"
          onClick={onDevelop}
          disabled={developBusy}
          className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-3 py-1 font-medium disabled:opacity-50"
        >
          {developBusy ? "Developing…" : "Develop fully"}
        </button>
      </div>

      {saveState.status === "error" && <div className="mt-2 text-[12px] text-red-700">{saveState.message}</div>}
    </div>
  )
}
