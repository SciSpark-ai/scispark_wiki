import { describe, expect, it } from "vitest"
import type { PaperRecord } from "../types"
import { originalPaperUrl } from "../source-link"

function paper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: {},
    title: "A paper",
    authors: [],
    fields: [],
    source: "openalex",
    ...overrides,
  }
}

describe("originalPaperUrl", () => {
  it("prefers the canonical DOI resolver over an open-access file URL", () => {
    expect(
      originalPaperUrl(
        paper({
          ids: { doi: "10.21203/rs.3.rs-10788928/v1" },
          oaUrl: "https://www.researchsquare.com/article/rs-10788928/latest.pdf",
        }),
      ),
    ).toBe("https://doi.org/10.21203/rs.3.rs-10788928/v1")
  })

  it("uses the arXiv abstract page and preserves legacy identifier segments", () => {
    expect(originalPaperUrl(paper({ ids: { arxiv: "math/0211159" }, source: "arxiv" }))).toBe(
      "https://arxiv.org/abs/math/0211159",
    )
  })

  it("falls back to a validated source URL and rejects unsafe schemes", () => {
    expect(
      originalPaperUrl(
        paper({
          htmlUrl: "javascript:alert(1)",
          oaUrl: "https://publisher.example/paper/123",
        }),
      ),
    ).toBe("https://publisher.example/paper/123")
  })

  it("returns undefined when no trustworthy source identity is available", () => {
    expect(originalPaperUrl(paper({ htmlUrl: "file:///tmp/paper.html" }))).toBeUndefined()
  })
})
