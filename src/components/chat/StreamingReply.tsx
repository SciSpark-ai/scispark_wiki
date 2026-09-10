"use client"

import { SparkyBadge } from "@/components/brand/SparkyBadge"

/** A provisional reply: no citation links or save action until validation finishes. */
export function StreamingReply({ text, label = "Sparky is responding…" }: { text: string; label?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <SparkyBadge state={text ? "responding" : "thinking"} />
      <div data-streaming-reply aria-busy="true" className="min-w-0 flex-1 rounded-card border border-border-warm bg-light-surface px-4 py-3">
        <p role="status" className="text-[12px] text-muted-text">{label}</p>
        {text && <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-espresso">{text}<span aria-hidden="true" className="ml-1 inline-block h-3 w-1 rounded-full bg-orange motion-safe:animate-pulse" /></p>}
      </div>
    </div>
  )
}
