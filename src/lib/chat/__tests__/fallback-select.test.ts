import { describe, it, expect } from "vitest"
import type { Bundle } from "../../vault/bundle"
import type { Frontmatter, WikiPage } from "../../vault/types"
import { fallbackSelectPages } from "../fallback-select"
import { MAX_SELECTED_PAGES } from "../select-pages"

const fm = (title: string, tags: string[] = []): Frontmatter => ({
  type: "concept",
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags,
  related: [],
  sources: [],
})

function bundleFromPages(
  entries: Array<{ id: string; title: string; tags?: string[] }>,
): Bundle {
  const pages = new Map<string, WikiPage>()
  for (const e of entries) {
    pages.set(e.id, {
      id: e.id,
      path: `${e.id}.md`,
      frontmatter: fm(e.title, e.tags),
      body: "",
    })
  }
  return { pages, links: [], errors: [] }
}

// A bundle shaped like a real neuroscience-of-language vault, not a fixture
// tailored to make the matcher pass — the point of this test is to catch the
// SP4 failure class (synthetic fixtures joining cleanly while real titles/tags
// don't share the tokens you'd assume).
const REALISTIC_BUNDLE = bundleFromPages([
  {
    id: "wiki/methods/trf-estimation",
    title: "Temporal Response Function (TRF) Estimation",
    tags: ["trf", "encoding-models", "eeg"],
  },
  {
    id: "wiki/concepts/encoding-decoding-models",
    title: "Encoding vs. Decoding Models in Neural Signal Analysis",
    tags: ["decoding", "encoding-models", "neural-signal-analysis"],
  },
  {
    id: "wiki/methods/ridge-regularization",
    title: "Ridge Regularization for Neural Regression Models",
    tags: ["ridge-regression", "regularization"],
  },
])

describe("fallbackSelectPages — realistic matching", () => {
  it("reaches the page whose title/tags actually share a significant term with a natural question", () => {
    const result = fallbackSelectPages(REALISTIC_BUNDLE, "what do I know about decoding models?")
    expect(result).toEqual(["wiki/concepts/encoding-decoding-models"])
  })

  it("returns [] for a question with no significant-term overlap with any page", () => {
    const result = fallbackSelectPages(REALISTIC_BUNDLE, "quantum error correction")
    expect(result).toEqual([])
  })

  it("returns [] when the question's tokens are all stopwords or too short", () => {
    // "with" and "model"/"models" are stopwords, "the"/"of" are <4 chars —
    // nothing survives significantTokens, and none of the short words ("the",
    // "of") match any page's tags either.
    const result = fallbackSelectPages(REALISTIC_BUNDLE, "with the model of models")
    expect(result).toEqual([])
  })
})

describe("fallbackSelectPages — short domain acronyms matching tags exactly", () => {
  it("reaches the eeg-tagged page for a question whose only content word is a short acronym", () => {
    // "EEG" is 3 characters — significantTokens drops it on both sides of
    // the match, which is exactly the SP4-class bug the review caught: the
    // TRF page is tagged "eeg" and this vault's whole subject is EEG, so a
    // fallback that can never match short tags fails on precisely the real
    // data it exists to serve. "what"/"know"/"about" survive significantTokens
    // but share nothing with any page, so this result is driven entirely by
    // the exact short-word-to-tag match on "eeg".
    const result = fallbackSelectPages(REALISTIC_BUNDLE, "what do we know about EEG?")
    expect(result).toEqual(["wiki/methods/trf-estimation"])
  })

  it("returns [] when a short question word matches no page's tags", () => {
    const result = fallbackSelectPages(REALISTIC_BUNDLE, "abc")
    expect(result).toEqual([])
  })

  it("does not match a short question word against a page's title — tags only", () => {
    // Deliberately tag-only: "erp" appears in this page's TITLE but not in
    // its tags, so it must NOT match. If this ever gets loosened to also
    // check titles, this assertion should fail and force that to be a
    // conscious decision.
    const bundle = bundleFromPages([
      {
        id: "wiki/methods/erp-component-analysis",
        title: "ERP Component Analysis Methods",
        tags: ["event-related-potentials", "component-analysis"],
      },
    ])
    const result = fallbackSelectPages(bundle, "erp")
    expect(result).toEqual([])
  })
})

describe("fallbackSelectPages — ranking and stability", () => {
  it("breaks ties in score by ascending page id", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/methods/ridge-regularization",
        title: "Ridge Regularization for Neural Regression Models",
        tags: ["ridge-regression", "regularization"],
      },
      {
        id: "wiki/methods/artifact-removal-in-neural-recordings",
        title: "Artifact Removal in Neural Recordings",
        tags: ["neural", "artifact-removal", "preprocessing"],
      },
      {
        id: "wiki/concepts/encoding-decoding-models",
        title: "Encoding vs. Decoding Models in Neural Signal Analysis",
        tags: ["decoding", "encoding-models", "neural-signal-analysis"],
      },
    ])
    // All three share exactly one significant token ("neural") with the
    // question and nothing else — a genuine 3-way tie.
    const result = fallbackSelectPages(bundle, "neural processing pipelines")
    expect(result).toEqual([
      "wiki/concepts/encoding-decoding-models",
      "wiki/methods/artifact-removal-in-neural-recordings",
      "wiki/methods/ridge-regularization",
    ])
  })

  it("ranks a page with more shared significant tokens above one with fewer", () => {
    const bundle = bundleFromPages([
      {
        id: "wiki/concepts/encoding-decoding-models",
        title: "Encoding vs. Decoding Models in Neural Signal Analysis",
        tags: ["decoding", "encoding-models", "neural-signal-analysis"],
      },
      {
        id: "wiki/methods/trf-estimation",
        title: "Temporal Response Function (TRF) Estimation",
        tags: ["trf", "encoding-models", "eeg"],
      },
    ])
    // "encoding", "neural", and "signal" all appear on the decoding-models
    // page (title + tags combined) — a 3-token match; only "encoding"
    // appears on the TRF page (via its tag) — a 1-token match. The
    // decoding page should outrank it.
    const result = fallbackSelectPages(bundle, "encoding and neural signal methods")
    expect(result).toEqual([
      "wiki/concepts/encoding-decoding-models",
      "wiki/methods/trf-estimation",
    ])
  })

  it("honours a limit smaller than the match count", () => {
    const bundle = bundleFromPages(
      Array.from({ length: 10 }, (_, i) => ({
        id: `wiki/concepts/topic-${i}`,
        title: "Neural Decoding Topic Page",
        tags: ["neural-decoding"],
      })),
    )
    const result = fallbackSelectPages(bundle, "neural decoding", 3)
    expect(result).toHaveLength(3)
    expect(result).toEqual(["wiki/concepts/topic-0", "wiki/concepts/topic-1", "wiki/concepts/topic-2"])
  })

  it("defaults the limit to MAX_SELECTED_PAGES when omitted", () => {
    const bundle = bundleFromPages(
      Array.from({ length: 12 }, (_, i) => ({
        id: `wiki/concepts/topic-${String(i).padStart(2, "0")}`,
        title: "Neural Decoding Topic Page",
        tags: ["neural-decoding"],
      })),
    )
    const result = fallbackSelectPages(bundle, "neural decoding")
    expect(result).toHaveLength(MAX_SELECTED_PAGES)
  })

  it("returns [] on an empty bundle", () => {
    const emptyBundle: Bundle = { pages: new Map(), links: [], errors: [] }
    const result = fallbackSelectPages(emptyBundle, "decoding models")
    expect(result).toEqual([])
  })
})
