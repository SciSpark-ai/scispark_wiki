/**
 * In-app navigation depth, so a "Back" control can tell the difference
 * between "the user got here by clicking through the app" (go back to
 * wherever that was) and "the user landed here directly" (a bookmark, a
 * pasted link, a fresh tab — there is nothing to go back TO, so fall back
 * to a real href).
 *
 * Why this exists at all: `/paper/[key]`'s back link used to be a hardcoded
 * `/papers`, so arriving from the home feed and clicking back dumped you on
 * Search (Tong, 2026-07-19). The fix is `router.back()`, which needs this
 * guard — calling it with no in-app history either does nothing or leaves
 * the app entirely.
 *
 * `window.history.length` can't answer this: it counts entries from the
 * whole tab session, including pages from other sites, and never resets.
 *
 * Session-scoped (sessionStorage) on purpose: a new tab starts fresh, which
 * is exactly the semantics of "can I go back within this session".
 */

export const NAV_CURRENT_KEY = "scispark:nav-current"
export const NAV_DEPTH_KEY = "scispark:nav-depth"

/** Minimal surface of sessionStorage this module needs, so tests can pass a fake. */
export interface NavStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStore(): NavStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    // Storage can throw outright (Safari private mode, blocked third-party
    // contexts). Degrading to null means "no in-app history" — the back
    // control falls back to its href, which is always a valid destination.
    return null
  }
}

/**
 * Records a navigation to `url`. **Idempotent per URL**: re-recording the
 * URL already stored as current is a no-op, so React StrictMode's
 * double-invoked effects (dev only) can't inflate the depth and make a
 * directly-loaded page look like it has history behind it.
 */
export function recordNavigation(url: string, store: NavStore | null = defaultStore()): void {
  if (!store) return
  try {
    if (store.getItem(NAV_CURRENT_KEY) === url) return
    store.setItem(NAV_CURRENT_KEY, url)
    const depth = Number(store.getItem(NAV_DEPTH_KEY) ?? "0")
    store.setItem(NAV_DEPTH_KEY, String((Number.isFinite(depth) ? depth : 0) + 1))
  } catch {
    // Quota/security errors are not worth breaking navigation over.
  }
}

/**
 * True once at least two distinct in-app URLs have been visited this
 * session — i.e. there is an in-app entry behind the current one, so
 * `router.back()` will land somewhere inside the app.
 */
export function hasInAppHistory(store: NavStore | null = defaultStore()): boolean {
  if (!store) return false
  try {
    const depth = Number(store.getItem(NAV_DEPTH_KEY) ?? "0")
    return Number.isFinite(depth) && depth > 1
  } catch {
    return false
  }
}
