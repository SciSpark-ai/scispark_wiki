import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { serializeDocument } from "../frontmatter"
import { loadBundle } from "../bundle"
import { buildIndexMarkdown, writeIndex, appendLog } from "../index-builder"
import type { Frontmatter } from "../types"

const fm = (type: string, title: string): Frontmatter => ({
  type, title, created: "2026-07-11", updated: "2026-07-11",
  tags: [], related: [], sources: ["s.pdf"],
})

describe("index + log", () => {
  it("builds a deterministic index grouped by type", async () => {
    const s = new MemoryVaultStorage()
    await s.write("wiki/concepts/b-concept.md", serializeDocument(fm("concept", "B Concept"), "x"))
    await s.write("wiki/concepts/a-concept.md", serializeDocument(fm("concept", "A Concept"), "x"))
    await s.write("wiki/papers/p1.md", serializeDocument(fm("paper", "Paper One"), "x"))
    const idx = buildIndexMarkdown(await loadBundle(s))
    expect(idx).toContain("## Concepts")
    expect(idx).toContain("## Papers")
    expect(idx.indexOf("A Concept")).toBeLessThan(idx.indexOf("B Concept"))
    expect(idx).toContain("- [[p1]] — Paper One")
    await writeIndex(s, await loadBundle(s))
    expect(await s.read("index.md")).toBe(idx)
  })

  it("appends log entries, creating log.md on first use", async () => {
    const s = new MemoryVaultStorage()
    await appendLog(s, { date: "2026-07-11", op: "ingest", summary: "Paper One" })
    await appendLog(s, { date: "2026-07-12", op: "lint", summary: "fixed links" })
    const log = (await s.read("log.md")) as string
    expect(log.startsWith("# Log")).toBe(true)
    expect(log).toContain("## [2026-07-11] ingest | Paper One")
    expect(log.indexOf("2026-07-11")).toBeLessThan(log.indexOf("2026-07-12"))
  })
})
