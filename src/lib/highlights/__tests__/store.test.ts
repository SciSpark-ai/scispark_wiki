import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { paperKey, type PaperRecord } from "../../papers/types"
import { sanitizeSlug, snapshotSource } from "../../wiki/acquire"
import {
  HIGHLIGHTS_DIR,
  highlightsPath,
  makeHighlightId,
  listHighlights,
  addHighlight,
  updateHighlight,
  removeHighlight,
  formatHighlightsForPrompt,
} from "../store"
import type { Highlight } from "../types"

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: makeHighlightId(() => new Date("2026-07-13T00:00:00.000Z")),
    anchor: {
      exact: "a key finding",
      prefix: "here is ",
      suffix: " in the paper",
      start: 10,
      end: 24,
    },
    color: "yellow",
    note: "",
    createdTs: "2026-07-13T00:00:00.000Z",
    ...overrides,
  }
}

const samplePaper: PaperRecord = {
  ids: { arxiv: "2101.00001" },
  title: "A Study of Things",
  authors: [{ name: "A. Author" }],
  fields: [],
  source: "arxiv",
}

describe("highlightsPath", () => {
  it("is highlights/<sanitized-key>.json", () => {
    expect(highlightsPath("arxiv:2101.00001")).toBe(`${HIGHLIGHTS_DIR}/arxiv-2101-00001.json`)
  })

  it("agrees with snapshotSource's slug for the same paper", async () => {
    const storage = new MemoryVaultStorage()
    const sourcePath = await snapshotSource(storage, samplePaper, "<html></html>")
    const slugFromSource = sourcePath.replace(/^sources\//, "").replace(/\.html$/, "")
    const slugFromHighlights = highlightsPath(paperKey(samplePaper))
      .replace(new RegExp(`^${HIGHLIGHTS_DIR}/`), "")
      .replace(/\.json$/, "")
    expect(slugFromHighlights).toBe(slugFromSource)
    expect(slugFromHighlights).toBe(sanitizeSlug(paperKey(samplePaper)))
  })
})

describe("listHighlights", () => {
  it("returns [] for a missing file", async () => {
    const storage = new MemoryVaultStorage()
    expect(await listHighlights(storage, "arxiv:2101.00001")).toEqual([])
  })

  it("returns [] for a corrupt JSON file", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(highlightsPath("arxiv:2101.00001"), "{not valid json")
    expect(await listHighlights(storage, "arxiv:2101.00001")).toEqual([])
  })

  it("returns [] when the file contains valid JSON that isn't an array", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(highlightsPath("arxiv:2101.00001"), JSON.stringify({ not: "an array" }))
    expect(await listHighlights(storage, "arxiv:2101.00001")).toEqual([])
  })
})

describe("addHighlight", () => {
  it("round-trips a single highlight through add -> list", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h = makeHighlight()

    await addHighlight(storage, key, h)
    const listed = await listHighlights(storage, key)

    expect(listed).toEqual([h])
  })

  it("two sequential adds produce 2 entries", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h1 = makeHighlight({ id: "h1" })
    const h2 = makeHighlight({ id: "h2" })

    await addHighlight(storage, key, h1)
    await addHighlight(storage, key, h2)

    const listed = await listHighlights(storage, key)
    expect(listed).toHaveLength(2)
    expect(listed.map((h) => h.id)).toEqual(["h1", "h2"])
  })

  it("10 concurrent adds land all 10 entries with no lost writes", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => addHighlight(storage, key, makeHighlight({ id: `h${i}` }))),
    )

    const listed = await listHighlights(storage, key)
    expect(listed).toHaveLength(10)
    expect(new Set(listed.map((h) => h.id)).size).toBe(10)
  })

  it("pretty-prints the JSON file", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    await addHighlight(storage, key, makeHighlight())
    const raw = await storage.read(highlightsPath(key))
    expect(raw).toContain("\n")
    expect(raw).toContain("  ")
  })
})

describe("updateHighlight", () => {
  it("patches color and note only, leaving other fields untouched", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h = makeHighlight({ id: "h1", color: "yellow", note: "" })
    await addHighlight(storage, key, h)

    await updateHighlight(storage, key, "h1", { color: "blue", note: "important" })

    const listed = await listHighlights(storage, key)
    expect(listed).toEqual([{ ...h, color: "blue", note: "important" }])
  })

  it("is a no-op when the id is absent", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h = makeHighlight({ id: "h1" })
    await addHighlight(storage, key, h)

    await updateHighlight(storage, key, "missing", { color: "blue" })

    const listed = await listHighlights(storage, key)
    expect(listed).toEqual([h])
  })
})

describe("removeHighlight", () => {
  it("drops the highlight matching id", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h1 = makeHighlight({ id: "h1" })
    const h2 = makeHighlight({ id: "h2" })
    await addHighlight(storage, key, h1)
    await addHighlight(storage, key, h2)

    await removeHighlight(storage, key, "h1")

    const listed = await listHighlights(storage, key)
    expect(listed).toEqual([h2])
  })

  it("is a no-op when the id is absent", async () => {
    const storage = new MemoryVaultStorage()
    const key = "arxiv:2101.00001"
    const h = makeHighlight({ id: "h1" })
    await addHighlight(storage, key, h)

    await removeHighlight(storage, key, "missing")

    const listed = await listHighlights(storage, key)
    expect(listed).toEqual([h])
  })
})

describe("makeHighlightId", () => {
  it("produces distinct ids across successive calls even with the same injected now", () => {
    const now = () => new Date("2026-07-13T00:00:00.000Z")
    const id1 = makeHighlightId(now)
    const id2 = makeHighlightId(now)
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^h_\d+_\d+$/)
    expect(id2).toMatch(/^h_\d+_\d+$/)
  })
})

describe("formatHighlightsForPrompt", () => {
  it("formats an exact-only highlight as the trimmed exact text", () => {
    const h = makeHighlight({ anchor: { exact: "  a key finding  ", prefix: "", suffix: "", start: 0, end: 1 } })
    expect(formatHighlightsForPrompt([h])).toEqual(["a key finding"])
  })

  it("appends the note when present", () => {
    const h = makeHighlight({
      anchor: { exact: "a key finding", prefix: "", suffix: "", start: 0, end: 1 },
      note: "worth revisiting",
    })
    expect(formatHighlightsForPrompt([h])).toEqual(["a key finding — worth revisiting"])
  })

  it("returns one string per highlight in order", () => {
    const h1 = makeHighlight({ anchor: { exact: "first", prefix: "", suffix: "", start: 0, end: 1 } })
    const h2 = makeHighlight({ anchor: { exact: "second", prefix: "", suffix: "", start: 0, end: 1 }, note: "n" })
    expect(formatHighlightsForPrompt([h1, h2])).toEqual(["first", "second — n"])
  })

  it("returns [] for an empty list", () => {
    expect(formatHighlightsForPrompt([])).toEqual([])
  })
})
