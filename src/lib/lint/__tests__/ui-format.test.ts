import { describe, it, expect } from "vitest"
import {
  formatDeepLintConfirm,
  formatLintFindingCount,
  lintKindLabel,
  formatLintPairProgress,
  formatDeepLintLabel,
} from "../ui-format"

describe("formatDeepLintConfirm", () => {
  it("formats to 2 decimal places with the proceed prompt", () => {
    expect(formatDeepLintConfirm(1.234)).toBe("~$1.23 — proceed?")
  })

  it("handles zero", () => {
    expect(formatDeepLintConfirm(0)).toBe("~$0.00 — proceed?")
  })
})

describe("formatLintFindingCount", () => {
  it("says 'no findings' for zero", () => {
    expect(formatLintFindingCount(0)).toBe("no findings")
  })

  it("singularizes for exactly one", () => {
    expect(formatLintFindingCount(1)).toBe("1 finding")
  })

  it("pluralizes for more than one", () => {
    expect(formatLintFindingCount(3)).toBe("3 findings")
  })

  it("treats negative counts the same as zero", () => {
    expect(formatLintFindingCount(-1)).toBe("no findings")
  })
})

describe("lintKindLabel", () => {
  it("maps every known LintKind to a non-empty label", () => {
    expect(lintKindLabel("orphan")).toBe("Orphan page")
    expect(lintKindLabel("broken-link")).toBe("Broken link")
    expect(lintKindLabel("bad-frontmatter")).toBe("Bad frontmatter")
    expect(lintKindLabel("index-drift")).toBe("Index drift")
    expect(lintKindLabel("contradiction")).toBe("Contradiction")
    expect(lintKindLabel("stale-claim")).toBe("Stale claim")
  })

  it("falls back to the raw key for an unrecognized kind", () => {
    // @ts-expect-error — deliberately passing an unknown kind to exercise the fallback
    expect(lintKindLabel("mystery-kind")).toBe("mystery-kind")
  })
})

describe("formatLintPairProgress", () => {
  it("1-indexes the pair for display", () => {
    expect(formatLintPairProgress({ index: 0, total: 5 })).toBe("Judging pair 1 of 5…")
    expect(formatLintPairProgress({ index: 4, total: 5 })).toBe("Judging pair 5 of 5…")
  })
})

describe("formatDeepLintLabel", () => {
  it("shows the plain label when the estimate is null", () => {
    expect(formatDeepLintLabel(null)).toBe("Run deep lint")
  })

  it("shows the real estimate to 2 decimal places once loaded", () => {
    expect(formatDeepLintLabel(0.02)).toBe("Run deep lint (~$0.02)")
  })
})
