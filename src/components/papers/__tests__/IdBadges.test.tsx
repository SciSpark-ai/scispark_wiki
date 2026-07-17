// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { IdBadges } from "../IdBadges"

describe("IdBadges (C4: DOI yes, internal ids no)", () => {
  it("renders doi/arxiv/pmid and never openalex/s2", () => {
    const html = renderToStaticMarkup(
      <IdBadges ids={{ doi: "10.1/x", arxiv: "2409.08710", openalex: "W123", s2: "S456", pmid: "789" }} />,
    )
    expect(html).toContain("10.1/x")
    expect(html).toContain("2409.08710")
    expect(html).toContain("789")
    expect(html).not.toContain("W123")
    expect(html).not.toContain("S456")
    expect(html.toLowerCase()).not.toContain("openalex")
  })
})
