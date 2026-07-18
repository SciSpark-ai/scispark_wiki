// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { PaperMeta } from "../PaperMeta"

describe("PaperMeta", () => {
  it("renders the TL;DR sentence and tag chips", () => {
    const html = renderToStaticMarkup(<PaperMeta tldr="A wearable method for tracking auditory attention." tags={["ear-eeg", "auditory attention"]} />)
    expect(html).toContain("A wearable method for tracking auditory attention.")
    expect(html).toContain("ear-eeg")
    expect(html).toContain("auditory attention")
  })

  it("renders nothing when there is no tldr and no tags (pre-enrich saved page)", () => {
    const html = renderToStaticMarkup(<PaperMeta />)
    expect(html).toBe("")
  })

  it("renders the tldr alone when tags are empty", () => {
    const html = renderToStaticMarkup(<PaperMeta tldr="Just a tldr." tags={[]} />)
    expect(html).toContain("Just a tldr.")
  })
})
