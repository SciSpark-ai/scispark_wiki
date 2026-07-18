// Task-11 fix wave, Finding 3: PaperSynthesis renders the paper page's own
// BODY, which (per buildPaperPage, src/lib/wiki/authoring.ts) always starts
// with `# {title}` and may include a `## Abstract` section — both of which
// PaperHeader (rendered directly above, in every page state) already shows.
// stripRedundantSynthesisSections trims exactly those two redundant pieces
// so the ingested-state page doesn't show the title/abstract twice, while
// leaving every other section (Digest, Links, and anything else) untouched.
import { describe, it, expect } from "vitest"
import { stripRedundantSynthesisSections } from "../PaperSynthesis"

describe("stripRedundantSynthesisSections", () => {
  it("drops a title-only body down to nothing", () => {
    const body = "# Ear-EEG for Auditory Attention Decoding\n"
    expect(stripRedundantSynthesisSections(body)).toBe("")
  })

  it("drops the title and the Abstract section, keeping Digest (real buildPaperPage order: title, Digest, Abstract, Links)", () => {
    const body = [
      "# Ear-EEG for Auditory Attention Decoding",
      "",
      "## Digest",
      "",
      "A wearable ear-EEG method for tracking auditory attention.",
      "",
      "## Abstract",
      "",
      "We study ear-EEG in this paper.",
      "",
      "## Links",
      "",
      "- arXiv: https://arxiv.org/abs/2409.08710",
      "",
    ].join("\n")

    const stripped = stripRedundantSynthesisSections(body)

    expect(stripped).not.toContain("# Ear-EEG for Auditory Attention Decoding")
    expect(stripped).not.toContain("## Abstract")
    expect(stripped).not.toContain("We study ear-EEG in this paper.")
    expect(stripped).toContain("## Digest")
    expect(stripped).toContain("A wearable ear-EEG method for tracking auditory attention.")
    expect(stripped).toContain("## Links")
    expect(stripped).toContain("- arXiv: https://arxiv.org/abs/2409.08710")
    // No leftover double-blank-line seam where the Abstract section was cut out.
    expect(stripped).not.toContain("\n\n\n")
  })

  it("drops the Abstract section wherever it falls (abstract in the middle, more sections after it)", () => {
    const body = [
      "# Title",
      "",
      "## Abstract",
      "",
      "Abstract text goes here.",
      "",
      "## Links",
      "",
      "- DOI: 10.1000/example",
      "",
    ].join("\n")

    const stripped = stripRedundantSynthesisSections(body)

    expect(stripped).not.toContain("# Title")
    expect(stripped).not.toContain("## Abstract")
    expect(stripped).not.toContain("Abstract text goes here.")
    expect(stripped).toContain("## Links")
    expect(stripped).toContain("- DOI: 10.1000/example")
  })

  it("leaves other sections untouched when there is no Abstract section", () => {
    const body = [
      "# Title",
      "",
      "## Digest",
      "",
      "Digest text.",
      "",
      "## Links",
      "",
      "- DOI: 10.1000/example",
      "",
    ].join("\n")

    const stripped = stripRedundantSynthesisSections(body)

    expect(stripped).not.toContain("# Title")
    expect(stripped).toContain("## Digest")
    expect(stripped).toContain("Digest text.")
    expect(stripped).toContain("## Links")
    expect(stripped).toContain("- DOI: 10.1000/example")
  })
})
