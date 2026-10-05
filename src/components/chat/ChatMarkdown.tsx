"use client"

import { useMemo } from "react"
import { renderMarkdown } from "@/components/wiki/markdown-preview"
import { cn } from "@/components/ui/cn"
import styles from "./StreamingReply.module.css"

/** Answer prose is formatted; navigation stays in the validated citation cards. */
export function ChatMarkdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const content = useMemo(() => renderMarkdown(text, { links: false, preserveLineBreaks: true }), [text])
  return (
    <div
      data-streaming-text={streaming || undefined}
      className={cn("mt-2 min-w-0 text-[14px] leading-relaxed text-espresso [overflow-wrap:anywhere] [&_p]:whitespace-pre-line [&>:first-child]:mt-0 [&>:last-child]:mb-0", streaming && styles.streaming)}
    >
      {content}
    </div>
  )
}
