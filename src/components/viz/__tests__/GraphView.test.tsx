import { describe, it, expect } from "vitest"
import {
  nodeSize,
  MIN_NODE_SIZE,
  MAX_NODE_SIZE,
  VIZ_CAT_COUNT,
  FALLBACK_COMMUNITY_PALETTE,
  communityColorVarName,
  communityColor,
} from "../graph-style"
import { labelThresholdForRatio } from "../labels"

// Pure-helper tests only — GraphView.tsx itself imports sigma/graphology,
// which touch WebGL/canvas at import time (see the file's top-of-file
// comment) and can't be safely mounted under jsdom. The reducer/sizing
// logic these helpers back is exercised visually via the live-browser pass
// documented in the task report.

describe("nodeSize", () => {
  it("returns MIN_NODE_SIZE for a degree-0 node", () => {
    expect(nodeSize(0, 10)).toBe(MIN_NODE_SIZE)
  })

  it("returns MIN_NODE_SIZE when maxDegree is 0 (an edgeless graph)", () => {
    expect(nodeSize(0, 0)).toBe(MIN_NODE_SIZE)
    expect(nodeSize(5, 0)).toBe(MIN_NODE_SIZE)
  })

  it("returns MAX_NODE_SIZE when degree === maxDegree", () => {
    expect(nodeSize(10, 10)).toBe(MAX_NODE_SIZE)
  })

  it("is monotonically non-decreasing in degree", () => {
    const sizes = [0, 1, 2, 5, 10].map((d) => nodeSize(d, 10))
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1])
    }
  })

  it("compresses via sqrt so mid-degree nodes size above a linear scale", () => {
    const linear = MIN_NODE_SIZE + (MAX_NODE_SIZE - MIN_NODE_SIZE) * (4 / 10)
    expect(nodeSize(4, 10)).toBeGreaterThan(linear)
  })

  it("never exceeds MAX_NODE_SIZE even if degree > maxDegree", () => {
    expect(nodeSize(50, 10)).toBe(MAX_NODE_SIZE)
  })

  it("treats a negative degree as 0", () => {
    expect(nodeSize(-3, 10)).toBe(MIN_NODE_SIZE)
  })
})

describe("labelThresholdForRatio", () => {
  it("returns a positive finite threshold at the default camera ratio (1)", () => {
    const t = labelThresholdForRatio(1)
    expect(t).toBeGreaterThan(0)
    expect(Number.isFinite(t)).toBe(true)
  })

  it("increases as the ratio increases (zoomed further out needs a bigger node to label)", () => {
    expect(labelThresholdForRatio(4)).toBeGreaterThan(labelThresholdForRatio(1))
  })

  it("decreases as the ratio decreases (zoomed in reveals more labels)", () => {
    expect(labelThresholdForRatio(0.25)).toBeLessThan(labelThresholdForRatio(1))
  })

  it("is boundary-safe for zero, negative, and non-finite ratios", () => {
    expect(Number.isFinite(labelThresholdForRatio(0))).toBe(true)
    expect(Number.isFinite(labelThresholdForRatio(-1))).toBe(true)
    expect(Number.isFinite(labelThresholdForRatio(NaN))).toBe(true)
    expect(Number.isFinite(labelThresholdForRatio(Infinity))).toBe(true)
  })
})

describe("communityColorVarName", () => {
  it("maps communities 0-7 to --viz-cat-1 through --viz-cat-8", () => {
    for (let i = 0; i < VIZ_CAT_COUNT; i++) {
      expect(communityColorVarName(i)).toBe(`--viz-cat-${i + 1}`)
    }
  })

  it("wraps around past 8", () => {
    expect(communityColorVarName(8)).toBe("--viz-cat-1")
    expect(communityColorVarName(9)).toBe("--viz-cat-2")
    expect(communityColorVarName(16)).toBe("--viz-cat-1")
    expect(communityColorVarName(23)).toBe("--viz-cat-8")
  })
})

describe("communityColor", () => {
  const palette = FALLBACK_COMMUNITY_PALETTE

  it("indexes directly for communities within range", () => {
    expect(communityColor(0, palette)).toBe(palette[0])
    expect(communityColor(7, palette)).toBe(palette[7])
  })

  it("wraps around past the palette length", () => {
    expect(communityColor(8, palette)).toBe(palette[0])
    expect(communityColor(9, palette)).toBe(palette[1])
    expect(communityColor(16, palette)).toBe(palette[0])
  })

  it("falls back safely for an empty palette", () => {
    expect(communityColor(3, [])).toBe(FALLBACK_COMMUNITY_PALETTE[0])
  })
})

describe("FALLBACK_COMMUNITY_PALETTE", () => {
  it("has exactly VIZ_CAT_COUNT entries", () => {
    expect(FALLBACK_COMMUNITY_PALETTE.length).toBe(VIZ_CAT_COUNT)
  })
})
