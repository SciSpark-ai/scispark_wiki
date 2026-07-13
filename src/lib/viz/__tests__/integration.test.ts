import { describe, it, expect, vi, beforeAll } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle, type Bundle } from "../../vault/bundle"
import { buildPaperPage, buildAuthorSkeletons, composePage, paperSlug, type PageDraft } from "../../wiki/authoring"
import type { PaperRecord } from "../../papers/types"
import type { Frontmatter } from "../../vault/types"
import { SIGNAL_WEIGHTS, deriveKnowledgeGraph, type KnowledgeGraph } from "../graph"
import { deriveTimeline, UNFILED_LANE_ID, type Timeline } from "../timeline"
import { deriveAuthorNetwork, type AuthorNetwork } from "../authors"
import { CITATIONS_DIR, deriveCitationFlow, loadCitationRefs, type CitationFlow } from "../citations"
import type { CitationRef } from "../../papers/citations-core"

/**
 * Seeded-vault integration test (M8 Task 7): builds a ~6-paper vault through
 * the REAL authoring path (buildPaperPage/buildAuthorSkeletons, same as
 * ingest) plus hand-composed concept/topic/finding pages (no builder exists
 * for those types — composePage keeps the frontmatter contract), then runs
 * ALL FOUR viz derivations off one `loadBundle` call and asserts cross-view
 * coherence. This is the regression net for the whole derivation layer over
 * production-shaped data; each derivation already has focused unit tests in
 * its own __tests__ file.
 *
 * The vault is deliberately laid out so exactly one pair — the paper
 * "Attention Is All You Need" (P1) and the concept "Attention Mechanism"
 * (C1) — has all four graph signals nonzero and hand-computable:
 *
 *   - wikilink: C1's body links directly to P1                      -> 1
 *   - sharedSource: P1 and C1 share exactly one sources[] entry      -> 1
 *   - adamicAdar: the topic "Deep Learning Architectures" (T1) links
 *     directly to BOTH P1 and C1, and links to nothing/is linked by
 *     nothing else, so it is P1/C1's only common neighbor, with
 *     degree(T1) = 2                                                -> 1/ln(2)
 *   - typeAffinity: paper<->concept is an affine pair                -> 1
 *
 * No other page in the vault touches P1, C1, or T1, so this triple's
 * neighbor sets are exactly as designed above.
 */

const TODAY = "2026-07-13"

function paper(overrides: Partial<PaperRecord>): PaperRecord {
  return {
    ids: {},
    title: "Untitled",
    authors: [],
    fields: [],
    source: "arxiv",
    ...overrides,
  }
}

function draft(
  type: string,
  path: string,
  title: string,
  extra: Partial<Frontmatter> = {},
  body = `# ${title}\n`,
): PageDraft {
  return {
    path,
    frontmatter: {
      type,
      title,
      created: TODAY,
      updated: TODAY,
      tags: [],
      related: [],
      sources: [],
      ...extra,
    },
    body,
  }
}

const pageId = (d: PageDraft) => d.path.slice(0, -3)

async function seedVault() {
  const storage = new MemoryVaultStorage()

  // --- Papers (6, overlapping authors, >=3 distinct years, doi/arxiv ids) --
  const p1 = paper({
    title: "Attention Is All You Need",
    authors: [{ name: "Alice Author" }, { name: "Bob Builder" }],
    year: 2017,
    ids: { arxiv: "1706.03762" },
  })
  const p2 = paper({
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    authors: [{ name: "Bob Builder" }, { name: "Carol Chen" }],
    year: 2018,
    ids: { arxiv: "1810.04805" },
  })
  const p3 = paper({
    title: "Language Models are Few-Shot Learners",
    authors: [{ name: "Carol Chen" }, { name: "Dave Diaz" }],
    year: 2020,
    ids: { doi: "10.1000/gpt3-paper" },
  })
  const p4 = paper({
    title: "Scaling Laws for Neural Language Models",
    authors: [{ name: "Alice Author" }, { name: "Bob Builder" }], // repeats P1's pair -> papers: 2
    year: 2021,
    ids: { arxiv: "2001.08361" },
  })
  const p5 = paper({
    title: "Training Compute-Optimal Large Language Models",
    authors: [{ name: "Dave Diaz" }, { name: "Erin Evans" }],
    year: 2022,
    ids: { doi: "10.1000/chinchilla-paper" },
  })
  const p6 = paper({
    title: "LLaMA: Open and Efficient Foundation Language Models",
    authors: [{ name: "Erin Evans" }, { name: "Alice Author" }],
    year: 2023,
    ids: { arxiv: "2302.13971" },
  })

  const p1Draft = buildPaperPage(p1, { fullText: true, today: TODAY, sources: ["seed:s2-1706.03762"] })
  const p2Draft = buildPaperPage(p2, { fullText: true, today: TODAY, sources: ["seed:s2-1810.04805"] })
  const p3Draft = buildPaperPage(p3, { fullText: false, today: TODAY, sources: ["seed:s2-gpt3"] })
  const p4Draft = buildPaperPage(p4, { fullText: true, today: TODAY, sources: ["seed:s2-2001.08361"] })
  const p5Draft = buildPaperPage(p5, { fullText: false, today: TODAY, sources: ["seed:s2-chinchilla"] })
  const p6Draft = buildPaperPage(p6, { fullText: true, today: TODAY, sources: ["seed:s2-2302.13971"] })

  for (const d of [p1Draft, p2Draft, p3Draft, p4Draft, p5Draft, p6Draft]) {
    await storage.write(d.path, composePage(d))
  }

  // --- Author skeletons via the real builder, for >=2 papers ---------------
  const existingIds = new Set<string>()
  const p1Authors = buildAuthorSkeletons(p1, { existingIds, today: TODAY, paperPageSlug: paperSlug(p1) })
  for (const d of p1Authors) {
    existingIds.add(pageId(d))
    await storage.write(d.path, composePage(d))
  }
  // Bob Builder already exists from p1Authors -> buildAuthorSkeletons skips
  // him here (production behavior: skeleton pages are created once, never
  // relinked deterministically to later co-authored papers).
  const p2Authors = buildAuthorSkeletons(p2, { existingIds, today: TODAY, paperPageSlug: paperSlug(p2) })
  for (const d of p2Authors) {
    existingIds.add(pageId(d))
    await storage.write(d.path, composePage(d))
  }

  // --- Concepts (3), wikilinked/related to papers and topics ---------------
  const c1 = draft(
    "concept",
    "wiki/concepts/attention-mechanism.md",
    "Attention Mechanism",
    { sources: ["seed:s2-1706.03762", "extra:concept-source"] },
    `# Attention Mechanism\n\nIntroduced in [[1706-03762]].\n`,
  )
  const c2 = draft(
    "concept",
    "wiki/concepts/scaling-laws.md",
    "Scaling Laws",
    {},
    `# Scaling Laws\n\nDescribed in [[2001-08361]] and explored further under [[scaling]].\n`,
  )
  const c3 = draft(
    "concept",
    "wiki/concepts/pretraining-objectives.md",
    "Pretraining Objectives",
    {},
    `# Pretraining Objectives\n\nUsed in [[1810-04805]] and [[10-1000-gpt3-paper]].\n`,
  )

  // --- Topics (2) ------------------------------------------------------------
  const t1 = draft(
    "topic",
    "wiki/topics/deep-learning.md",
    "Deep Learning Architectures",
    {},
    `# Deep Learning Architectures\n\nFoundational paper: [[1706-03762]]. Central concept: [[attention-mechanism]].\n`,
  )
  const t2 = draft(
    "topic",
    "wiki/topics/scaling.md",
    "Compute Scaling",
    {},
    `# Compute Scaling\n\nKey papers: [[2001-08361]] and [[10-1000-chinchilla-paper]].\n`,
  )

  // --- Findings (2), wikilinked to papers, one related[] to a topic --------
  const f1 = draft(
    "finding",
    "wiki/findings/scaling-improves-perplexity.md",
    "Scaling improves perplexity predictably",
    { created: "2021-06-15", updated: "2021-06-15", related: ["scaling"] },
    `# Scaling improves perplexity predictably\n\nBased on [[2001-08361]].\n`,
  )
  const f2 = draft(
    "finding",
    "wiki/findings/bert-bidirectional-context.md",
    "BERT bidirectional context helps understanding",
    { created: "2019-03-01", updated: "2019-03-01" },
    `# BERT bidirectional context helps understanding\n\nDemonstrated by [[1810-04805]].\n`,
  )

  for (const d of [c1, c2, c3, t1, t2, f1, f2]) await storage.write(d.path, composePage(d))

  // --- Citation cache: paper A (P3) references paper B (P5) by doi and
  // paper C (P6) by arxiv, plus one reference to a paper not in the vault --
  const p3Refs: CitationRef[] = [
    { ids: { doi: "10.1000/chinchilla-paper" }, title: p5.title },
    { ids: { arxiv: "2302.13971" }, title: p6.title },
    { ids: { doi: "10.9999/not-in-vault" }, title: "Unrelated Paper" },
  ]
  await storage.write(
    `${CITATIONS_DIR}/${paperSlug(p3)}.json`,
    JSON.stringify({ fetchedAt: "2026-07-13T00:00:00.000Z", references: p3Refs }),
  )

  return {
    storage,
    ids: {
      P1: pageId(p1Draft),
      P2: pageId(p2Draft),
      P3: pageId(p3Draft),
      P4: pageId(p4Draft),
      P5: pageId(p5Draft),
      P6: pageId(p6Draft),
      C1: pageId(c1),
      T1: pageId(t1),
      T2: pageId(t2),
      F1: pageId(f1),
      F2: pageId(f2),
    },
  }
}

describe("viz derivation — seeded-vault integration (all four derivations)", () => {
  let ids: Awaited<ReturnType<typeof seedVault>>["ids"]
  let storage: Awaited<ReturnType<typeof seedVault>>["storage"]
  let bundle: Bundle
  let graph: KnowledgeGraph
  let timeline: Timeline
  let authorNetwork: AuthorNetwork

  beforeAll(async () => {
    const seeded = await seedVault()
    storage = seeded.storage
    ids = seeded.ids

    // loadBundle called exactly once; every derivation below runs off this
    // same Bundle, so this is the shared cross-view fixture.
    bundle = await loadBundle(storage)

    graph = deriveKnowledgeGraph(bundle)
    timeline = deriveTimeline(bundle)
    authorNetwork = deriveAuthorNetwork(bundle)
  })

  it("seeds a vault with no parse/ambiguity errors", () => {
    expect(bundle.errors).toEqual([])
    expect(bundle.pages.size).toBe(6 + 3 /* authors */ + 3 /* concepts */ + 2 /* topics */ + 2 /* findings */)
  })

  it("graph: the P1<->C1 edge carries the hand-computed combined weight; every node resolves", () => {
    const edge = graph.edges.find(
      (e) => (e.source === ids.P1 && e.target === ids.C1) || (e.source === ids.C1 && e.target === ids.P1),
    )
    expect(edge).toBeDefined()
    expect(edge!.signals.wikilink).toBe(1)
    expect(edge!.signals.sharedSource).toBe(1)
    expect(edge!.signals.adamicAdar).toBeCloseTo(1 / Math.log(2), 9)
    expect(edge!.signals.typeAffinity).toBe(1)

    const expectedWeight =
      1 * SIGNAL_WEIGHTS.wikilink +
      1 * SIGNAL_WEIGHTS.sharedSource +
      (1 / Math.log(2)) * SIGNAL_WEIGHTS.adamicAdar +
      1 * SIGNAL_WEIGHTS.typeAffinity
    expect(edge!.weight).toBeCloseTo(expectedWeight, 9)

    expect(graph.communities).toBeGreaterThanOrEqual(1)
    for (const node of graph.nodes) {
      expect(bundle.pages.has(node.id)).toBe(true)
    }
  })

  it("timeline: lanes match the seeded topic links; year span matches the seeded years", () => {
    expect(timeline.minYear).toBe(2017)
    expect(timeline.maxYear).toBe(2023)

    const laneById = new Map(timeline.lanes.map((l) => [l.id, l]))
    expect(laneById.get(ids.T1)?.itemCount).toBe(1) // just P1
    expect(laneById.get(ids.T2)?.itemCount).toBe(3) // P4, P5, F1
    expect(laneById.get(UNFILED_LANE_ID)?.itemCount).toBe(4) // P2, P3, P6, F2

    const itemById = new Map(timeline.items.map((i) => [i.id, i]))
    expect(itemById.get(ids.P1)?.laneIds).toEqual([ids.T1])
    expect(itemById.get(ids.P4)?.laneIds).toEqual([ids.T2])
    expect(itemById.get(ids.P5)?.laneIds).toEqual([ids.T2])
    expect(itemById.get(ids.F1)?.laneIds).toEqual([ids.T2])
    expect(itemById.get(ids.P2)?.laneIds).toEqual([UNFILED_LANE_ID])
    expect(itemById.get(ids.P3)?.laneIds).toEqual([UNFILED_LANE_ID])
    expect(itemById.get(ids.P6)?.laneIds).toEqual([UNFILED_LANE_ID])
    expect(itemById.get(ids.F2)?.laneIds).toEqual([UNFILED_LANE_ID])
  })

  it("authors: the seeded co-authorship pair has papers: 2; paperCount right; a skeleton page matched", () => {
    const nodeByKey = new Map(authorNetwork.nodes.map((n) => [n.key, n]))
    const alice = nodeByKey.get("alice author")
    const bob = nodeByKey.get("bob builder")
    const carol = nodeByKey.get("carol chen")

    expect(alice).toBeDefined()
    expect(bob).toBeDefined()
    expect(alice!.paperCount).toBe(3) // P1, P4, P6
    expect(bob!.paperCount).toBe(3) // P1, P2, P4
    expect(alice!.pageId).toBe("wiki/authors/alice-author")
    expect(bob!.pageId).toBe("wiki/authors/bob-builder")
    expect(carol!.pageId).toBe("wiki/authors/carol-chen")

    const coauthorEdge = authorNetwork.edges.find(
      (e) =>
        (e.a === "alice author" && e.b === "bob builder") || (e.a === "bob builder" && e.b === "alice author"),
    )
    expect(coauthorEdge).toBeDefined()
    expect(coauthorEdge!.papers).toBe(2) // P1 and P4
  })

  it("citations: cache-only load (no fetchImpl call) yields exactly the seeded A->B and A->C edges", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetchImpl must not be called — this is a cache-only load")
    }) as unknown as typeof fetch

    const refsByPageId = await loadCitationRefs(storage, bundle, { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(refsByPageId.has(ids.P3)).toBe(true)

    const flow: CitationFlow = deriveCitationFlow(bundle, refsByPageId)
    expect(flow.edges).toHaveLength(2)
    expect(flow.edges).toContainEqual({ citing: ids.P3, cited: ids.P5 })
    expect(flow.edges).toContainEqual({ citing: ids.P3, cited: ids.P6 })
    expect(flow.papersTotal).toBe(6)
    expect(flow.papersWithData).toBe(1)
  })
})
