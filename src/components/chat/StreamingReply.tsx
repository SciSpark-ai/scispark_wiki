"use client"

import { SparkyBadge } from "@/components/brand/SparkyBadge"
import styles from "./StreamingReply.module.css"
import { ChatMarkdown } from "./ChatMarkdown"

/** A provisional reply: no citation links or save action until validation finishes. */
export function StreamingReply({ text, label = "Thinking…" }: { text: string; label?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <SparkyBadge state={text ? "responding" : "thinking"} />
      <div data-streaming-reply aria-busy="true" className="min-w-0 flex-1 rounded-faq border border-border-warm bg-light-surface px-4 py-3">
        <div role="status" className="flex min-h-5 items-center gap-3 text-[12px] text-muted-text">
          <span>{text ? "Sparky" : label}</span>
          {!text && <span data-thinking-dots aria-hidden="true" className={styles.dots}><span /><span /><span /></span>}
          {text && <span className="sr-only">is responding</span>}
        </div>
        {text && <ChatMarkdown text={text} streaming />}
      </div>
    </div>
  )
}
