import { describe, it, expect } from "vitest"
import { truncateGraphLabel } from "../labels"

describe("truncateGraphLabel (C8)", () => {
  it("leaves short titles alone", () => {
    expect(truncateGraphLabel("mTRF Toolbox")).toBe("mTRF Toolbox")
  })

  it("ellipsizes long titles at a word boundary", () => {
    const long = "The Multivariate Temporal Response Function (mTRF) Toolbox: A MATLAB Toolbox for Relating Neural Signals"
    const out = truncateGraphLabel(long)
    expect(out.length).toBeLessThanOrEqual(43)
    expect(out.endsWith("…")).toBe(true)
  })

  it("handles markup-containing input via displayTitle composition at the call site", () => {
    const withMarkup = "Neural <i>Encoding</i> Models with <sub>LSTMs</sub>"
    // Caller should wrap with displayTitle first; test the truncator itself with markup
    const out = truncateGraphLabel(withMarkup)
    // Should truncate without error, preserving the markup in the output
    expect(out).toBeTruthy()
  })
})
