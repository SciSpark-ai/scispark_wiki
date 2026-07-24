import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter } from "../../vault/types"
import {
  EMPTY_FILTERS,
  filterBundle,
  filterOptions,
  isEmptyFilters,
  pageYear,
  type VizFilters,
} from "../filter"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

async function bundleFrom(files: Record<string, [Frontmatter, string]>) {
  const storage = new MemoryVaultStorage()
  for (const [path, [frontmatter, body]] of Object.entries(files)) {
    await storage.write(path, serializeDocument(frontmatter, body))
  }
  return loadBundle(storage)
}

describe("EMPTY_FILTERS / isEmptyFilters", () => {
  it("EMPTY_FILTERS is the canonical empty shape", () => {
    expect(EMPTY_FILTERS).toEqual({ types: [], tags: [], yearRange: { min: null, max: null } })
  })

  it("isEmptyFilters is true for EMPTY_FILTERS and equivalent shapes", () => {
    expect(isEmptyFilters(EMPTY_FILTERS)).toBe(true)
    expect(isEmptyFilters({ types: [], tags: [], yearRange: { min: null, max: null } })).toBe(true)
  })

  it("isEmptyFilters is false when any dimension is set", () => {
    expect(isEmptyFilters({ types: ["paper"], tags: [], yearRange: { min: null, max: null } })).toBe(false)
    expect(isEmptyFilters({ types: [], tags: ["nlp"], yearRange: { min: null, max: null } })).toBe(false)
    expect(isEmptyFilters({ types: [], tags: [], yearRange: { min: 2020, max: null } })).toBe(false)
    expect(isEmptyFilters({ types: [], tags: [], yearRange: { min: null, max: 2020 } })).toBe(false)
  })
})

describe("pageYear", () => {
  it("uses frontmatter.year when it is a number", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024, created: "2020-01-01" }), "x"],
    })
    expect(pageYear(bundle.pages.get("wiki/papers/p1")!)).toBe(2024)
  })

  it("falls back to the leading 4 digits of created when frontmatter.year is not a number", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { created: "2023-05-02" }), "x"],
    })
    expect(pageYear(bundle.pages.get("wiki/papers/p1")!)).toBe(2023)
  })

  it("returns null when neither is derivable", async () => {
    const bundle = await bundleFrom({
      "wiki/concepts/c1.md": [fm("concept", "C1", { created: "not-a-date" }), "x"],
    })
    expect(pageYear(bundle.pages.get("wiki/concepts/c1")!)).toBe(null)
  })
})

describe("filterBundle — identity", () => {
  it("EMPTY_FILTERS returns the input bundle by reference", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "x"],
    })
    expect(filterBundle(bundle, EMPTY_FILTERS)).toBe(bundle)
  })

  it("any filters shape that isEmptyFilters() as true returns the input bundle by reference", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2024 }), "x"],
    })
    const filters: VizFilters = { types: [], tags: [], yearRange: { min: null, max: null } }
    expect(filterBundle(bundle, filters)).toBe(bundle)
  })
})

describe("filterBundle — type filter", () => {
  it("keeps only pages whose type is in filters.types", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1"), "x"],
      "wiki/concepts/c1.md": [fm("concept", "C1"), "x"],
      "wiki/methods/m1.md": [fm("method", "M1"), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, types: ["paper"] })
    expect([...filtered.pages.keys()]).toEqual(["wiki/papers/p1"])
  })
})

describe("filterBundle — ANY-tag semantics", () => {
  it("keeps a page if it has any of the selected tags", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { tags: ["nlp", "rl"] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { tags: ["vision"] }), "x"],
      "wiki/papers/p3.md": [fm("paper", "P3", { tags: ["rl"] }), "x"],
      "wiki/papers/p4.md": [fm("paper", "P4", { tags: [] }), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, tags: ["nlp", "rl"] })
    expect([...filtered.pages.keys()].sort()).toEqual(["wiki/papers/p1", "wiki/papers/p3"])
  })
})

describe("filterBundle — year range", () => {
  it("drops dated papers outside the range but keeps undated pages", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/old.md": [fm("paper", "Old", { year: 2015 }), "x"],
      "wiki/papers/mid.md": [fm("paper", "Mid", { year: 2022 }), "x"],
      "wiki/papers/new.md": [fm("paper", "New", { year: 2026 }), "x"],
      "wiki/concepts/c1.md": [fm("concept", "C1", { created: "not-a-date" }), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, yearRange: { min: 2020, max: 2024 } })
    expect([...filtered.pages.keys()].sort()).toEqual(["wiki/concepts/c1", "wiki/papers/mid"])
  })

  it("only min set constrains the lower bound", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/old.md": [fm("paper", "Old", { year: 2015 }), "x"],
      "wiki/papers/new.md": [fm("paper", "New", { year: 2026 }), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, yearRange: { min: 2020, max: null } })
    expect([...filtered.pages.keys()]).toEqual(["wiki/papers/new"])
  })

  it("only max set constrains the upper bound", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/old.md": [fm("paper", "Old", { year: 2015 }), "x"],
      "wiki/papers/new.md": [fm("paper", "New", { year: 2026 }), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, yearRange: { min: null, max: 2020 } })
    expect([...filtered.pages.keys()]).toEqual(["wiki/papers/old"])
  })
})

describe("filterBundle — links & errors", () => {
  it("prunes a link when one endpoint is filtered out, keeps errors unchanged", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1"), "Links to [[c1]]."],
      "wiki/concepts/c1.md": [fm("concept", "C1"), "x"],
    })
    expect(bundle.links).toEqual([{ from: "wiki/papers/p1", to: "wiki/concepts/c1" }])
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, types: ["paper"] })
    expect(filtered.links).toEqual([])
    expect(filtered.errors).toBe(bundle.errors)
  })

  it("keeps a link when both endpoints survive", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1"), "Links to [[p2]]."],
      "wiki/papers/p2.md": [fm("paper", "P2"), "x"],
    })
    const filtered = filterBundle(bundle, { ...EMPTY_FILTERS, types: ["paper"] })
    expect(filtered.links).toEqual([{ from: "wiki/papers/p1", to: "wiki/papers/p2" }])
  })
})

describe("filterBundle — combined filters", () => {
  it("applies type, tag and year predicates together (AND across dimensions)", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/keep.md": [fm("paper", "Keep", { year: 2023, tags: ["nlp"] }), "x"],
      "wiki/papers/wrong-type.md": [fm("finding", "WrongType", { year: 2023, tags: ["nlp"] }), "x"],
      "wiki/papers/wrong-tag.md": [fm("paper", "WrongTag", { year: 2023, tags: ["vision"] }), "x"],
      "wiki/papers/wrong-year.md": [fm("paper", "WrongYear", { year: 2010, tags: ["nlp"] }), "x"],
    })
    const filtered = filterBundle(bundle, {
      types: ["paper"],
      tags: ["nlp"],
      yearRange: { min: 2020, max: 2025 },
    })
    expect([...filtered.pages.keys()]).toEqual(["wiki/papers/keep"])
  })
})

describe("filterOptions", () => {
  it("returns present types in PAGE_TYPES order, distinct sorted tags, and year bounds", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { year: 2020, tags: ["nlp", "rl"] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { year: 2024, tags: ["rl"] }), "x"],
      "wiki/concepts/c1.md": [fm("concept", "C1", { tags: ["vision"], created: "not-a-date" }), "x"],
    })
    const options = filterOptions(bundle)
    expect(options.types).toEqual(["paper", "concept"])
    expect(options.tags).toEqual(["nlp", "rl", "vision"])
    expect(options.yearBounds).toEqual({ min: 2020, max: 2024 })
  })

  it("yearBounds is null when no page has a derivable year", async () => {
    const bundle = await bundleFrom({
      "wiki/concepts/c1.md": [fm("concept", "C1", { created: "not-a-date" }), "x"],
    })
    const options = filterOptions(bundle)
    expect(options.yearBounds).toBe(null)
  })

  it("empty bundle -> empty options", async () => {
    const bundle = await bundleFrom({})
    const options = filterOptions(bundle)
    expect(options).toEqual({ types: [], tags: [], yearBounds: null })
  })
})
