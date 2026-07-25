// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { PaperRecord } from "@/lib/papers/types"
import type { VolumePoint } from "@/lib/trending/metrics"
import type { BoardTopic, BoardPaper, TrendingBoard } from "@/lib/trending/dashboard"
import { Sparkline } from "../Sparkline"
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
    weekly: [],
    papers: [boardPaper()],
    why: "Several groups converged on sub-quadratic attention this quarter.",
    relevant: false,
    ...overrides,
  }
}

function volumeSeries(n: number): VolumePoint[] {
  return Array.from({ length: n }, (_, i) => ({ weekStart: `2026-06-0${i + 1}`, count: i + 1 }))
}

describe("Sparkline", () => {
  it("renders nothing for a 1-point series", () => {
    const html = renderToStaticMarkup(<Sparkline points={volumeSeries(1)} />)
    expect(html).toBe("")
  })

  it("renders nothing for an empty series", () => {
    const html = renderToStaticMarkup(<Sparkline points={[]} />)
    expect(html).toBe("")
  })

  it("renders a polyline for a 5-point series", () => {
    const html = renderToStaticMarkup(<Sparkline points={volumeSeries(5)} />)
    expect(html).toContain("<polyline")
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
    version: 2,
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

  it("renders the threshold empty state when board.topics is empty", () => {
    const html = renderToStaticMarkup(
      <Leaderboard board={board({ topics: [] })} expandedKey={null} onToggle={() => {}} />,
    )
    expect(html).toMatch(/No topic cleared the activity threshold this window/)
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
