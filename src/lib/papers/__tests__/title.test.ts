import { describe, it, expect } from "vitest"
import { displayTitle } from "../title"

describe("displayTitle (C7)", () => {
  it("strips markup tags from source metadata", () => {
    expect(displayTitle("What are we <i>really</i> decoding?")).toBe("What are we really decoding?")
    expect(displayTitle("H<sub>2</sub>O and <b>bold</b>")).toBe("H2O and bold")
  })
  it("decodes common entities and collapses whitespace", () => {
    expect(displayTitle("A &amp; B  &lt;test&gt;&nbsp;C")).toBe("A & B <test> C")
  })
  it("leaves plain titles alone", () => {
    expect(displayTitle("Auditory Attention Decoding")).toBe("Auditory Attention Decoding")
  })
})
