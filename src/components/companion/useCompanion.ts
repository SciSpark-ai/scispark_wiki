"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { companionUtteranceRemote } from "@/lib/companion/client"
import { useCompanionStore } from "@/stores/companion-store"
import { useUIStore } from "@/stores/ui-store"

/** Ask the single shell-owned hook to check a just-completed app event. */
export function requestCompanionCheck(): void {
  window.dispatchEvent(new Event("companion-check"))
}

/** Mounted once in AppShell. Route/visibility changes cancel old streams and
 * clear stale messages. The server, not this component, owns delivery history. */
export function useCompanion(): () => void {
  const pathname = usePathname()
  const settingsSection = useUIStore((s) => s.settingsModalSection)
  const activeRequest = useRef<AbortController | null>(null)
  const clear = useCallback(() => {
    activeRequest.current?.abort()
    activeRequest.current = null
    useCompanionStore.getState().dismiss()
  }, [])
  // The server gates new events before spending. Stream IDs also invalidate
  // late replies when navigation, focus, or a feedback question takes priority.
  const reevaluate = useCallback(() => {
    if (document.hidden || settingsSection !== null || /^\/(?:onboarding|setup|chat|papers|settings)(?:\/|$)/.test(pathname ?? "/")) return
    if (document.activeElement?.matches("input, textarea, [contenteditable='true']")) return
    const streamId = useCompanionStore.getState().beginStream()
    if (streamId === null) return
    const controller = new AbortController()
    activeRequest.current = controller
    void (async () => {
      try {
        const utterance = await companionUtteranceRemote({
          route: pathname ?? "/",
        }, undefined, (draft) => {
          if (!document.hidden) useCompanionStore.getState().updateStream(streamId, draft)
        }, controller.signal)

        useCompanionStore.getState().finishStream(streamId, document.hidden ? null : utterance)
      } catch {
        useCompanionStore.getState().finishStream(streamId, null)
        // Fire-and-forget: a companion failure must never break the host page.
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null
      }
    })()
  }, [pathname, settingsSection])

  useEffect(() => {
    clear()
    reevaluate()
    const onVisibility = () => {
      clear()
      if (!document.hidden) reevaluate()
    }
    const onFocus = () => {
      if (document.activeElement?.matches("input, textarea, [contenteditable='true']")) clear()
    }
    window.addEventListener("companion-check", reevaluate)
    document.addEventListener("visibilitychange", onVisibility)
    document.addEventListener("focusin", onFocus)
    return () => {
      clear()
      window.removeEventListener("companion-check", reevaluate)
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("focusin", onFocus)
    }
  }, [reevaluate, clear])

  return reevaluate
}
