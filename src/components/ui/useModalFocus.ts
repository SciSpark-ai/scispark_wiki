"use client"

import { useEffect, type RefObject } from "react"

/** Contain a modal within the existing layout and restore its surrounding UI. */
export function useModalFocus(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void, fallbackFocus?: () => HTMLElement | null) {
  useEffect(() => {
    const panel = ref.current
    if (!open || !panel) return
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const background = new Map<HTMLElement, boolean>()
    for (let node: HTMLElement | null = panel; node?.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== node) {
          background.set(sibling, sibling.hasAttribute("inert"))
          sibling.setAttribute("inert", "")
        }
      }
      if (node.parentElement === document.body) break
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const focusable = () => [...panel.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')].filter((el) =>
      el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden],[inert]') &&
      getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden")
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return }
      if (event.key !== "Tab") return
      const items = focusable(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); panel.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault(); last!.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault(); first.focus()
      }
    }
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target)) panel.focus()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("focusin", containFocus)
    panel.focus()
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("focusin", containFocus)
      background.forEach((inert, element) => { if (!inert) element.removeAttribute("inert") })
      document.body.style.overflow = overflow
      const target = previous?.isConnected ? previous : fallbackFocus?.()
      target?.focus()
    }
  }, [ref, open, close, fallbackFocus])
}
