"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

const QUERY = "(prefers-reduced-motion: reduce)"
function subscribe(onChange: () => void) {
  const media = window.matchMedia?.(QUERY)
  media?.addEventListener?.("change", onChange)
  return () => media?.removeEventListener?.("change", onChange)
}

/** Scripted, pre-BYOK prompts only. Live AI replies use real provider streaming. */
export function ProgressiveText({ text }: { text: string }) {
  const [visible, setVisible] = useState(0)
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia?.(QUERY).matches ?? false, () => false)
  useEffect(() => {
    if (reduced) return
    let count = 0
    const timer = window.setInterval(() => {
      count = Math.min(text.length, count + 3)
      setVisible(count)
      if (count === text.length) window.clearInterval(timer)
    }, 24)
    return () => window.clearInterval(timer)
  }, [text, reduced])
  const length = reduced ? text.length : visible

  return (
    <span className="relative inline-block">
      <span className="sr-only">{text}</span>
      {/* Reserve the full prompt's size so the centered bubble never jumps. */}
      <span aria-hidden="true" className="invisible">{text}</span>
      <span aria-hidden="true" className="absolute inset-0">{text.slice(0, length)}{length < text.length && <span className="ml-0.5 inline-block h-3 w-1 rounded-full bg-orange motion-safe:animate-pulse" />}</span>
    </span>
  )
}
