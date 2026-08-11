import { describe, expect, it } from "vitest"
import {
  clearLegacyPrototypeData,
  detectLegacyPrototypeData,
  LEGACY_PROTOTYPE_KEYS,
  markLegacyPrototypeWarningSeen,
} from "../legacy-data"

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe("legacy prototype data", () => {
  it("detects without deleting, then clears only after the explicit clear action", () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_PROTOTYPE_KEYS[0], "fake notes")

    expect(detectLegacyPrototypeData(storage)).toEqual([LEGACY_PROTOTYPE_KEYS[0]])
    expect(storage.getItem(LEGACY_PROTOTYPE_KEYS[0])).toBe("fake notes")

    markLegacyPrototypeWarningSeen(storage)
    expect(detectLegacyPrototypeData(storage)).toEqual([])
    expect(storage.getItem(LEGACY_PROTOTYPE_KEYS[0])).toBe("fake notes")

    clearLegacyPrototypeData(storage)
    expect(storage.getItem(LEGACY_PROTOTYPE_KEYS[0])).toBeNull()
  })
})
