// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { PaperRecord } from "@/lib/papers/types"
import type { BoardTopic, BoardPaper, TrendingBoard } from "@/lib/trending/dashboard"
import { TRENDING_BOARD_VERSION } from "@/lib/trending/dashboard"
import { TrendBars } from "../TrendBars"
import { TopicRow } from "../TopicRow"
import { OverviewStrip } from "../OverviewStrip"
import { Leaderboard } from "../Leaderboard"
import { BreakoutPapers } from "../BreakoutPapers"

function paper(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ids: { arxiv: "2409.08710" },
    title: "Ear-EEG for <i>Auditory</i> Attention Decoding",
    authors: [{ name: "A. Researcher" }],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

function boardPaper(overrides: Partial<BoardPaper> = {}): BoardPaper {
  return {
    record: paper(),
    wikiPageId: null,
    ...overrides,
  }
}

function topic(overrides: Partial<BoardTopic> = {}): BoardTopic {
  return {
    key: "sparse-attention",
    label: "Sparse Attention",
    discipline: "Machine Learning",
    growth: 1,
    recentCount: 42,
    priorCount: 21,
    recentShare: 0.042,
    priorShare: 0.021,
    papers: [boardPaper()],
    why: "Several groups converged on sub-quadratic attention this quarter.",
    relevant: false,
    ...overrides,
  }
}

/** Every `height="…"` in the rendered SVG, in document order (prior bar, then recent bar). */
function barHeights(html: string): number[] {
  return [...html.matchAll(/height="([^"]*)"/g)]
    .map((m) => m[1])
    .slice(1) // the <svg> element's own height comes first
    .map(Number)
}

describe("TrendBars", () => {
  it("renders a zero-height prior bar for priorShare: 0 (the 'new' case) without NaN", () => {
    const html = renderToStaticMarkup(
      <TrendBars priorShare={0} recentShare={0.03} priorCount={0} recentCount={30} />,
    )
    expect(html).not.toContain("NaN")
    const [prior, recent] = barHeights(html)
    expect(prior).toBe(0)
    expect(recent).toBeGreaterThan(0)
  })

  it("scales both bars to the larger of the two SHARES", () => {
    const taller = renderToStaticMarkup(
      <TrendBars priorShare={0.01} recentShare={0.02} priorCount={10} recentCount={20} />,
    )
    const [priorUp, recentUp] = barHeights(taller)
    expect(recentUp).toBeGreaterThan(priorUp)
    expect(priorUp / recentUp).toBeCloseTo(0.5, 1) // recent is the max → full height, prior is half of it

    // ...and symmetrically for a row that really did lose share.
    const shorter = renderToStaticMarkup(
      <TrendBars priorShare={0.02} recentShare={0.01} priorCount={20} recentCount={10} />,
    )
    const [priorDown, recentDown] = barHeights(shorter)
    expect(priorDown).toBeGreaterThan(recentDown)
    expect(priorDown).toBe(recentUp) // the max always fills the same full height
  })

  it("REGRESSION: falling raw counts but a RISING share draws a TALLER recent bar, not a shorter one", () => {
    // The live Computer Science row: 184 → 134 papers while the corpus shrank
    // 22808 → 13953, i.e. −27% raw but +19% by share. Bars drawn from the raw
    // counts would shrink visibly beside a "+19%" badge — a chart contradicting
    // the number next to it, which is exactly the defect this replaced.
    const html = renderToStaticMarkup(
      <TrendBars priorShare={184 / 22808} recentShare={134 / 13953} priorCount={184} recentCount={134} />,
    )
    const [prior, recent] = barHeights(html)
    expect(recent).toBeGreaterThan(prior)
  })

  it("keeps the raw volumes in the accessible label without drawing them", () => {
    const html = renderToStaticMarkup(
      <TrendBars priorShare={184 / 22808} recentShare={134 / 13953} priorCount={184} recentCount={134} />,
    )
    expect(html).toContain("184")
    expect(html).toContain("134")
    expect(html).not.toContain("NaN")
  })

  it("renders both bars flat, with no NaN, when both shares are zero", () => {
    const html = renderToStaticMarkup(
      <TrendBars priorShare={0} recentShare={0} priorCount={0} recentCount={0} />,
    )
    expect(html).not.toContain("NaN")
    expect(barHeights(html)).toEqual([0, 0])
  })

  it("cannot emit a NaN height for a malformed share", () => {
    const html = renderToStaticMarkup(
      <TrendBars priorShare={Number.NaN} recentShare={Number.NaN} priorCount={1} recentCount={2} />,
    )
    expect(html).not.toContain("NaN")
    expect(barHeights(html)).toEqual([0, 0])
  })
})

describe("TopicRow growth badge", () => {
  it("shows +100% for growth: 1", () => {
    const html = renderToStaticMarkup(
      <TopicRow topic={topic({ growth: 1 })} rank={1} expanded={false} onToggle={() => {}} />,
    )
    expect(html).toContain("+100%")
  })

  it("shows the literal word 'new' for growth: null, never Infinity/NaN/em dash", () => {
    const html = renderToStaticMarkup(
      <TopicRow topic={topic({ growth: null })} rank={1} expanded={false} onToggle={() => {}} />,
    )
    expect(html).toContain(">new<")
    expect(html).not.toContain("∞")
    expect(html).not.toContain("NaN")
    expect(html).not.toContain("—")
  })

  it("shows a muted style for negative growth without throwing", () => {
    const html = renderToStaticMarkup(
      <TopicRow topic={topic({ growth: -0.25 })} rank={1} expanded={false} onToggle={() => {}} />,
    )
    expect(html).toContain("-25%")
  })
})

describe("TopicRow badge/bar agreement", () => {
  it("a positive badge is never drawn beside a shrinking recent bar", () => {
    // The live row: 184 → 134 papers, corpus 22808 → 13953. Badge +19%, and
    // the bars must agree with it.
    const html = renderToStaticMarkup(
      <TopicRow
        topic={topic({
          growth: 0.19,
          priorCount: 184,
          recentCount: 134,
          priorShare: 184 / 22808,
          recentShare: 134 / 13953,
        })}
        rank={1}
        expanded={false}
        onToggle={() => {}}
      />,
    )
    expect(html).toContain("+19%")
    const [prior, recent] = barHeights(html)
    expect(recent).toBeGreaterThan(prior)
  })

  it("shows the honest raw volumes as text on the expanded row", () => {
    const html = renderToStaticMarkup(
      <TopicRow
        topic={topic({ priorCount: 184, recentCount: 134 })}
        rank={1}
        expanded={true}
        onToggle={() => {}}
      />,
    )
    expect(html).toMatch(/134 papers this window/)
    expect(html).toMatch(/184 in the prior window/)
  })
})

describe("TopicRow relevance marker", () => {
  it("renders a 'Relevant to you' marker only when topic.relevant", () => {
    const relevantHtml = renderToStaticMarkup(
      <TopicRow topic={topic({ relevant: true })} rank={1} expanded={false} onToggle={() => {}} />,
    )
    const notRelevantHtml = renderToStaticMarkup(
      <TopicRow topic={topic({ relevant: false })} rank={1} expanded={false} onToggle={() => {}} />,
    )
    expect(relevantHtml).toMatch(/Relevant to you/i)
    expect(notRelevantHtml).not.toMatch(/Relevant to you/i)
  })
})

describe("TopicRow expand control", () => {
  it("is a real <button> with aria-expanded reflecting the expanded prop", () => {
    const collapsedHtml = renderToStaticMarkup(
      <TopicRow topic={topic()} rank={1} expanded={false} onToggle={() => {}} />,
    )
    const expandedHtml = renderToStaticMarkup(
      <TopicRow topic={topic()} rank={1} expanded={true} onToggle={() => {}} />,
    )
    expect(collapsedHtml).toMatch(/<button[^>]+aria-expanded="false"/)
    expect(expandedHtml).toMatch(/<button[^>]+aria-expanded="true"/)
  })
})

describe("TopicRow expanded content", () => {
  it("renders topic.why when present", () => {
    const html = renderToStaticMarkup(
      <TopicRow
        topic={topic({ why: "Several groups converged on sub-quadratic attention this quarter." })}
        rank={1}
        expanded={true}
        onToggle={() => {}}
      />,
    )
    expect(html).toContain("Several groups converged on sub-quadratic attention this quarter.")
  })

  it("shows an honest unavailable note (no empty paragraph) when why is null", () => {
    const html = renderToStaticMarkup(
      <TopicRow topic={topic({ why: null })} rank={1} expanded={true} onToggle={() => {}} />,
    )
    expect(html).not.toMatch(/<p[^>]*><\/p>/)
    expect(html.toLowerCase()).toMatch(/unavailable|not available|couldn't|could not/)
  })

  it("renders each representative paper as displayTitle linking to /paper/<slug>", () => {
    const html = renderToStaticMarkup(
      <TopicRow
        topic={topic({ papers: [boardPaper({ record: paper({ title: "Ear-EEG for <i>Auditory</i> Attention Decoding" }) })] })}
        rank={1}
        expanded={true}
        onToggle={() => {}}
      />,
    )
    expect(html).toContain("Ear-EEG for Auditory Attention Decoding")
    expect(html).not.toContain("<i>Auditory</i>")
    expect(html).toMatch(/href="\/paper\/2409-08710"/)
  })

  it("renders a wiki link only when wikiPageId is non-null", () => {
    const withWiki = renderToStaticMarkup(
      <TopicRow
        topic={topic({ papers: [boardPaper({ wikiPageId: "wiki/papers/ear-eeg-2409-08710" })] })}
        rank={1}
        expanded={true}
        onToggle={() => {}}
      />,
    )
    const withoutWiki = renderToStaticMarkup(
      <TopicRow
        topic={topic({ papers: [boardPaper({ wikiPageId: null })] })}
        rank={1}
        expanded={true}
        onToggle={() => {}}
      />,
    )
    expect(withWiki).toMatch(/href="\/wiki\/papers\/ear-eeg-2409-08710"/)
    expect(withoutWiki).not.toMatch(/href="\/wiki\/papers/)
  })
})

describe("OverviewStrip", () => {
  it("renders an em dash for a null topTopicLabel", () => {
    const html = renderToStaticMarkup(
      <OverviewStrip overview={{ totalRecent: 0, topTopicLabel: null, topTopicGrowth: null, relevantCount: 0 }} />,
    )
    expect(html).toContain("—")
  })

  it("renders the literal word 'new' for a null topTopicGrowth, never an em dash for it", () => {
    const html = renderToStaticMarkup(
      <OverviewStrip
        overview={{ totalRecent: 12, topTopicLabel: "Sparse Attention", topTopicGrowth: null, relevantCount: 1 }}
      />,
    )
    expect(html).toContain("Sparse Attention")
    expect(html).toMatch(/>new</)
  })

  it("phrases totalRecent without overclaiming an exact dedup total", () => {
    const html = renderToStaticMarkup(
      <OverviewStrip
        overview={{ totalRecent: 500, topTopicLabel: "Sparse Attention", topTopicGrowth: 0.5, relevantCount: 3 }}
      />,
    )
    expect(html).toContain("500")
    expect(html).toMatch(/across/i)
  })
})

function board(overrides: Partial<TrendingBoard> = {}): TrendingBoard {
  return {
    version: TRENDING_BOARD_VERSION,
    anchors: [{ id: "ml", label: "Machine Learning" }],
    overview: { totalRecent: 10, topTopicLabel: "Sparse Attention", topTopicGrowth: 1, relevantCount: 1 },
    topics: [topic()],
    breakouts: [],
    crossDisciplineNote: null,
    generatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  }
}

describe("Leaderboard", () => {
  it("renders the ordered list of topics", () => {
    const html = renderToStaticMarkup(
      <Leaderboard board={board()} expandedKey={null} onToggle={() => {}} />,
    )
    expect(html).toContain("Sparse Attention")
  })

  it("renders the threshold empty state when board.topics is empty and nothing failed", () => {
    const html = renderToStaticMarkup(
      <Leaderboard board={board({ topics: [] })} expandedKey={null} onToggle={() => {}} />,
    )
    expect(html).toMatch(/No topic cleared the activity threshold this window/)
  })

  it("does NOT blame the data when the board was emptied by a failed measurement", () => {
    // A failed count/grouping DROPS rows on purpose, so "no topic cleared the
    // threshold" would be a confident statement about the field when the truth
    // is our own outage.
    const html = renderToStaticMarkup(
      <Leaderboard
        board={board({ topics: [], dataError: "Machine Learning: corpus size for a..b failed (openalex down)" })}
        expandedKey={null}
        onToggle={() => {}}
      />,
    )
    expect(html).not.toMatch(/cleared the activity threshold/)
    expect(html).toMatch(/Couldn’t measure activity/)
    expect(html).toContain("openalex down")
  })
})

describe("BreakoutPapers", () => {
  it("renders null for an empty breakouts list", () => {
    const html = renderToStaticMarkup(<BreakoutPapers breakouts={[]} />)
    expect(html).toBe("")
  })

  it("renders a compact list of breakout papers", () => {
    const html = renderToStaticMarkup(
      <BreakoutPapers
        breakouts={[{ record: paper(), citationCount: 12, wikiPageId: null }]}
      />,
    )
    expect(html).toContain("Ear-EEG for Auditory Attention Decoding")
    expect(html).toContain("12")
  })
})
