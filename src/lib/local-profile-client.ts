import { PROFILE_HEADER } from "./local-profile-contract"

export const PROFILE_CHANGED_KEY = "scispark-profile-changed"
const ACTIVE_PROFILE_KEY = "scispark:active-profile"

/** Captured before the app mounts, so even cached clients and in-flight work
 * remain bound to the profile they started with after another tab switches. */
export function createProfileFetch(profileId: string, transport: typeof fetch, origin: string, onExpired: () => void, signal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    if (url.origin !== origin || !url.pathname.startsWith("/api/")) return transport(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(PROFILE_HEADER, profileId)
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const response = await transport(input, { ...init, headers,
      ...(signal ? { signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal } : {}),
    })
    if (response.headers.get("x-scispark-session-expired") === "1") onExpired()
    return response
  }
}

/** Persisted vault data stays on disk; per-tab drafts/history cannot cross profiles. */
export function clearProfileBrowserState(nextProfileId: string | null): void {
  if (sessionStorage.getItem(ACTIVE_PROFILE_KEY) === nextProfileId) return
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith("scispark:") || key.startsWith("review-edit:")) sessionStorage.removeItem(key)
  }
  if (nextProfileId) sessionStorage.setItem(ACTIVE_PROFILE_KEY, nextProfileId)
}

export function announceProfileChange(): void {
  localStorage.setItem(PROFILE_CHANGED_KEY, crypto.randomUUID())
}

export async function logoutLocalProfile(): Promise<void> {
  const response = await fetch("/api/local-profiles/session", { method: "DELETE" })
  if (!response.ok) throw new Error("Could not log out. Please try again.")
  clearProfileBrowserState(null)
  announceProfileChange()
  // Drop all module caches, stores, page state and pending navigation together.
  window.location.replace("/")
}
