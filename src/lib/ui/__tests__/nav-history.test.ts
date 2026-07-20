import { describe, it, expect } from "vitest"
import {
  recordNavigation,
  hasInAppHistory,
  NAV_CURRENT_KEY,
  NAV_DEPTH_KEY,
  type NavStore,
} from "../nav-history"

function fakeStore(initial: Record<string, string> = {}): NavStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

describe("nav-history", () => {
  it("reports no in-app history on a fresh session (direct load)", () => {
    const store = fakeStore()
    expect(hasInAppHistory(store)).toBe(false)
    recordNavigation("/paper/x", store)
    // One recorded URL = the landing page itself; there is nothing behind it.
    expect(hasInAppHistory(store)).toBe(false)
  })

  it("reports in-app history once a second distinct URL is visited", () => {
    const store = fakeStore()
    recordNavigation("/", store)
    recordNavigation("/paper/x", store)
    expect(hasInAppHistory(store)).toBe(true)
    expect(store.data[NAV_CURRENT_KEY]).toBe("/paper/x")
    expect(store.data[NAV_DEPTH_KEY]).toBe("2")
  })

  it("is idempotent per URL — a repeated record does not inflate depth (StrictMode double-effects)", () => {
    const store = fakeStore()
    recordNavigation("/paper/x", store)
    recordNavigation("/paper/x", store)
    recordNavigation("/paper/x", store)
    expect(store.data[NAV_DEPTH_KEY]).toBe("1")
    // The dev-only double-invoke must not make a direct load look navigable,
    // or Back would fire router.back() and leave the app entirely.
    expect(hasInAppHistory(store)).toBe(false)
  })

  it("treats distinct query strings on one pathname as separate entries", () => {
    const store = fakeStore()
    recordNavigation("/papers?q=eeg", store)
    recordNavigation("/papers?q=attention", store)
    expect(hasInAppHistory(store)).toBe(true)
  })

  it("degrades to 'no history' when storage is unavailable or corrupt", () => {
    expect(hasInAppHistory(null)).toBe(false)
    expect(hasInAppHistory(fakeStore({ [NAV_DEPTH_KEY]: "not-a-number" }))).toBe(false)
    // A corrupt depth must not crash the next record, and must recover.
    const store = fakeStore({ [NAV_DEPTH_KEY]: "not-a-number" })
    recordNavigation("/a", store)
    expect(store.data[NAV_DEPTH_KEY]).toBe("1")
  })

  it("does not throw when the store itself throws (private-mode storage)", () => {
    const throwing: NavStore = {
      getItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    expect(() => recordNavigation("/a", throwing)).not.toThrow()
    expect(hasInAppHistory(throwing)).toBe(false)
  })
})
