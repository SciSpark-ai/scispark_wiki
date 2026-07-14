import { describe, it, expect } from "vitest"
import {
  formatGroundingCount,
  formatDeepSparkConfirm,
  deepSparkPhaseLabel,
  describeDeepOutcome,
} from "../ui-format"
import type { DeepSparkOutcome } from "../deep"

describe("formatGroundingCount", () => {
  it("says 'no grounding' for zero", () => {
    expect(formatGroundingCount(0)).toBe("no grounding")
  })

  it("singularizes for exactly one", () => {
    expect(formatGroundingCount(1)).toBe("1 grounding source")
  })

  it("pluralizes for more than one", () => {
    expect(formatGroundingCount(3)).toBe("3 grounding sources")
  })

  it("treats negative counts the same as zero", () => {
    expect(formatGroundingCount(-1)).toBe("no grounding")
  })
})

describe("formatDeepSparkConfirm", () => {
  it("formats to 2 decimal places with the proceed prompt", () => {
    expect(formatDeepSparkConfirm(1.234)).toBe("~$1.23 — proceed?")
  })

  it("handles zero", () => {
    expect(formatDeepSparkConfirm(0)).toBe("~$0.00 — proceed?")
  })
})

describe("deepSparkPhaseLabel", () => {
  it("maps every known phase to a non-empty label", () => {
    expect(deepSparkPhaseLabel("grounding")).toBe("Grounding in your vault…")
    expect(deepSparkPhaseLabel("bottleneck")).toBe("Diagnosing the bottleneck…")
    expect(deepSparkPhaseLabel("ideation")).toBe("Generating idea candidates…")
    expect(deepSparkPhaseLabel("scoop-check")).toBe("Checking for prior work…")
    expect(deepSparkPhaseLabel("audit")).toBe("Auditing the idea…")
  })

  it("falls back to the raw key for an unknown phase", () => {
    expect(deepSparkPhaseLabel("mystery-phase")).toBe("mystery-phase")
  })
})

describe("describeDeepOutcome", () => {
  it("describes an idea outcome", () => {
    const outcome: DeepSparkOutcome = {
      kind: "idea",
      ideaPageId: "wiki/ideas/idea-x",
      changesetId: "cs-1",
      status: "in-progress",
    }
    expect(describeDeepOutcome(outcome)).toEqual({
      kind: "idea",
      heading: "Idea generated",
      message: "Status: in-progress",
    })
  })

  it("surfaces the honest do_not_generate reason verbatim", () => {
    const outcome: DeepSparkOutcome = { kind: "do_not_generate", reason: "The direction is too vague." }
    expect(describeDeepOutcome(outcome)).toEqual({
      kind: "do_not_generate",
      heading: "No idea generated",
      message: "The direction is too vague.",
    })
  })

  it("surfaces the honest abandoned reason verbatim", () => {
    const outcome: DeepSparkOutcome = { kind: "abandoned", reason: "Failed novelty check twice." }
    expect(describeDeepOutcome(outcome)).toEqual({
      kind: "abandoned",
      heading: "Idea abandoned after review",
      message: "Failed novelty check twice.",
    })
  })
})
