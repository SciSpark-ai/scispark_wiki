"use client"

import type { MouseEvent, ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { hasInAppHistory } from "@/lib/ui/nav-history"
import { cn } from "./cn"

export interface BackLinkProps {
  /** Where to go when there's no in-app history to go back to (direct
   * load, pasted link, fresh tab). Also the anchor's real `href`, so
   * middle-click / cmd-click / "open in new tab" all behave. */
  fallbackHref?: string
  children?: ReactNode
  className?: string
}

/**
 * A back control that returns the user to wherever they actually came
 * from, instead of one hardcoded route.
 *
 * Replaces `/paper/[key]`'s old "← Back to papers" link, which sent you to
 * Search no matter what — so opening a paper from the home feed and
 * clicking back landed you somewhere you'd never been (Tong, 2026-07-19).
 *
 * A real `<Link>` underneath, not a button: keyboard and modified clicks
 * keep working and the fallback destination is visible in the status bar.
 * A plain left click with in-app history behind it is intercepted into
 * `router.back()`, which also restores the previous page's scroll position
 * — returning you to your place in the feed rather than its top.
 */
export function BackLink({ fallbackHref = "/", children = "Back", className }: BackLinkProps) {
  const router = useRouter()

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks belong to the browser (new tab/window/download) —
    // never hijack them; they use the plain href.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    // No in-app history: let the anchor navigate to fallbackHref normally.
    if (!hasInAppHistory()) return
    e.preventDefault()
    router.back()
  }

  return (
    <Link
      href={fallbackHref}
      onClick={handleClick}
      className={cn("inline-block text-[13px] text-muted-text hover:text-espresso transition-colors", className)}
    >
      ← {children}
    </Link>
  )
}
