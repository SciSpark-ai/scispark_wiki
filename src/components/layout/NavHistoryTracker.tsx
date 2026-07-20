"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { recordNavigation } from "@/lib/ui/nav-history"

/**
 * Shell-level recorder feeding `hasInAppHistory()` (see nav-history.ts) —
 * mounted once in AppShell, renders nothing.
 *
 * Reads the URL from `window.location` rather than `useSearchParams()` on
 * purpose: this sits above every page in the shell, and useSearchParams
 * opts the whole subtree out of static rendering. The pathname hook is
 * enough to fire the effect on each client navigation; location then
 * supplies the query string for free.
 *
 * Consumers read the recorded depth in CLICK handlers, never during render,
 * so this component's effect ordering relative to page effects (children
 * run first) is irrelevant — everything has settled long before a user can
 * click.
 */
export default function NavHistoryTracker() {
  const pathname = usePathname()
  useEffect(() => {
    recordNavigation(window.location.pathname + window.location.search)
  }, [pathname])
  return null
}
