import { describe, it, expect } from "vitest"
import { normalizeDoi, paperKey, mergeRecords, PaperSourceError, type PaperRecord } from "../types"

function makeRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: {},
    title: "Attention Is All You Need",
    authors: [{ name: "A. Vaswani" }],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

describe("normalizeDoi", () => {
  it("strips the https://doi.org/ prefix", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc")
  })

  it("strips the http://doi.org/ prefix", () => {
    expect(normalizeDoi("http://doi.org/10.1000/ABC")).toBe("10.1000/abc")
  })

  it("strips the doi: prefix", () => {
    expect(normalizeDoi("doi:10.1000/ABC")).toBe("10.1000/abc")
  })

  it("strips prefixes case-insensitively", () => {
    expect(normalizeDoi("DOI:10.1000/abc")).toBe("10.1000/abc")
    expect(normalizeDoi("HTTPS://DOI.ORG/10.1000/abc")).toBe("10.1000/abc")
  })

  it("lowercases and trims the result", () => {
    expect(normalizeDoi("  10.1000/ABC  ")).toBe("10.1000/abc")
  })

  it("returns undefined for empty, whitespace-only, null, or undefined input", () => {
    expect(normalizeDoi("")).toBeUndefined()
    expect(normalizeDoi("   ")).toBeUndefined()
    expect(normalizeDoi(null)).toBeUndefined()
    expect(normalizeDoi(undefined)).toBeUndefined()
  })
})

describe("paperKey", () => {
  it("prefers doi when both doi and arxiv are present", () => {
    const record = makeRecord({ ids: { doi: "10.1000/abc", arxiv: "2406.01234" } })
    expect(paperKey(record)).toBe("doi:10.1000/abc")
  })

  it("falls back to arxiv when doi is absent", () => {
    const record = makeRecord({ ids: { arxiv: "2406.01234" } })
    expect(paperKey(record)).toBe("arxiv:2406.01234")
  })

  it("falls back to pmid when doi and arxiv are absent", () => {
    const record = makeRecord({ ids: { pmid: "12345678" } })
    expect(paperKey(record)).toBe("pmid:12345678")
  })

  it("falls back to s2 when doi, arxiv, and pmid are absent", () => {
    const record = makeRecord({ ids: { s2: "abc123s2" } })
    expect(paperKey(record)).toBe("s2:abc123s2")
  })

  it("falls back to openalex when doi, arxiv, pmid, and s2 are absent", () => {
    const record = makeRecord({ ids: { openalex: "W2741809807" } })
    expect(paperKey(record)).toBe("openalex:w2741809807")
  })

  it("falls back to lowercased, trimmed title when no ids are present", () => {
    const record = makeRecord({ ids: {}, title: "  Attention Is All You Need  " })
    expect(paperKey(record)).toBe("title:attention is all you need")
  })

  it("prefixes every key with the id kind so id spaces cannot collide", () => {
    expect(paperKey(makeRecord({ ids: { doi: "10.1/x" } }))).toMatch(/^doi:/)
    expect(paperKey(makeRecord({ ids: { arxiv: "10.1" } }))).toMatch(/^arxiv:/)
    expect(paperKey(makeRecord({ ids: {}, title: "10.1" }))).toBe("title:10.1")
  })
})

describe("mergeRecords", () => {
  it("unions ids, with a's value winning on conflict", () => {
    const a = makeRecord({ ids: { doi: "10.1/a", arxiv: "2406.00001" } })
    const b = makeRecord({ ids: { doi: "10.1/b", pmid: "999" } })
    const merged = mergeRecords(a, b)
    expect(merged.ids).toEqual({ doi: "10.1/a", arxiv: "2406.00001", pmid: "999" })
  })

  it("prefers a defined field over an undefined one from either side", () => {
    const a = makeRecord({ venue: undefined, year: 2024 })
    const b = makeRecord({ venue: "NeurIPS", year: undefined })
    const merged = mergeRecords(a, b)
    expect(merged.venue).toBe("NeurIPS")
    expect(merged.year).toBe(2024)
  })

  it("keeps the longer abstract", () => {
    const a = makeRecord({ abstract: "short" })
    const b = makeRecord({ abstract: "a much longer abstract text" })
    expect(mergeRecords(a, b).abstract).toBe("a much longer abstract text")
    expect(mergeRecords(b, a).abstract).toBe("a much longer abstract text")
  })

  it("handles one-sided abstracts", () => {
    const a = makeRecord({ abstract: undefined })
    const b = makeRecord({ abstract: "only here" })
    expect(mergeRecords(a, b).abstract).toBe("only here")
    expect(mergeRecords(b, a).abstract).toBe("only here")
  })

  it("takes the max citationCount, undefined-safe", () => {
    expect(mergeRecords(makeRecord({ citationCount: 5 }), makeRecord({ citationCount: 12 })).citationCount).toBe(12)
    expect(mergeRecords(makeRecord({ citationCount: 12 }), makeRecord({ citationCount: 5 })).citationCount).toBe(12)
    expect(mergeRecords(makeRecord({ citationCount: undefined }), makeRecord({ citationCount: 7 })).citationCount).toBe(7)
    expect(mergeRecords(makeRecord({ citationCount: 7 }), makeRecord({ citationCount: undefined })).citationCount).toBe(7)
    expect(mergeRecords(makeRecord({ citationCount: undefined }), makeRecord({ citationCount: undefined })).citationCount).toBeUndefined()
  })

  it("preserves citationCount=0 when merged with undefined", () => {
    expect(mergeRecords(makeRecord({ citationCount: 0 }), makeRecord({ citationCount: undefined })).citationCount).toBe(0)
  })

  it("preserves citationCount=0 from b when a is undefined", () => {
    expect(mergeRecords(makeRecord({ citationCount: undefined }), makeRecord({ citationCount: 0 })).citationCount).toBe(0)
  })

  it("dedupes fields into a union that preserves order", () => {
    const a = makeRecord({ fields: ["ml", "nlp"] })
    const b = makeRecord({ fields: ["nlp", "cv"] })
    expect(mergeRecords(a, b).fields).toEqual(["ml", "nlp", "cv"])
  })

  it("uses whichever author list is longer", () => {
    const a = makeRecord({ authors: [{ name: "One" }] })
    const b = makeRecord({ authors: [{ name: "One" }, { name: "Two" }] })
    expect(mergeRecords(a, b).authors).toEqual([{ name: "One" }, { name: "Two" }])
    expect(mergeRecords(b, a).authors).toEqual([{ name: "One" }, { name: "Two" }])
  })

  it("keeps a's source", () => {
    const a = makeRecord({ source: "arxiv" })
    const b = makeRecord({ source: "openalex" })
    expect(mergeRecords(a, b).source).toBe("arxiv")
    expect(mergeRecords(b, a).source).toBe("openalex")
  })
})

describe("PaperSourceError", () => {
  it("is an Error subclass carrying an optional status", () => {
    const err = new PaperSourceError("rate limited", 429)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe("rate limited")
    expect(err.status).toBe(429)
  })

  it("allows omitting status", () => {
    const err = new PaperSourceError("boom")
    expect(err.status).toBeUndefined()
  })
})
