import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter } from "../../vault/types"
import { SIGNAL_WEIGHTS, deriveKnowledgeGraph, adamicAdar } from "../graph"

const fm = (type: string, title: string, extra: Partial<Frontmatter> = {}): Frontmatter => ({
  type,
  title,
  created: "2026-07-11",
  updated: "2026-07-11",
  tags: [],
  related: [],
  sources: [],
  ...extra,
})

async function bundleFrom(files: Record<string, [Frontmatter, string]>) {
  const storage = new MemoryVaultStorage()
  for (const [path, [frontmatter, body]] of Object.entries(files)) {
    await storage.write(path, serializeDocument(frontmatter, body))
  }
  return loadBundle(storage)
}

function edgeBetween(graph: ReturnType<typeof deriveKnowledgeGraph>, a: string, b: string) {
  return graph.edges.find(
    (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a),
  )
}

describe("deriveKnowledgeGraph — wikilink signal", () => {
  it("one edge with wikilink signal x3.0 when a page links the other", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/a.md": [fm("note", "A"), "Links to [[b]]."],
      "wiki/notes/b.md": [fm("note", "B"), "No links here."],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const edge = edgeBetween(graph, "wiki/notes/a", "wiki/notes/b")
    expect(edge).toBeDefined()
    expect(edge!.signals).toEqual({ wikilink: 1, sharedSource: 0, adamicAdar: 0, typeAffinity: 0 })
    expect(edge!.weight).toBeCloseTo(1 * SIGNAL_WEIGHTS.wikilink, 9)
  })

  it("related[] slug resolves to the same wikilink signal (no body link needed)", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/a.md": [fm("note", "A", { related: ["b"] }), "No wikilinks in body."],
      "wiki/notes/b.md": [fm("note", "B"), "Plain text."],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const edge = edgeBetween(graph, "wiki/notes/a", "wiki/notes/b")
    expect(edge).toBeDefined()
    expect(edge!.signals.wikilink).toBe(1)
    expect(edge!.weight).toBeCloseTo(1 * SIGNAL_WEIGHTS.wikilink, 9)
  })
})

describe("deriveKnowledgeGraph — sharedSource signal", () => {
  it("two papers sharing 2 sources -> sharedSource=2 -> +8.0", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { sources: ["s1", "s2", "s3"] }), "no links"],
      "wiki/papers/p2.md": [fm("paper", "P2", { sources: ["s2", "s3", "s4"] }), "no links"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const edge = edgeBetween(graph, "wiki/papers/p1", "wiki/papers/p2")
    expect(edge).toBeDefined()
    expect(edge!.signals.sharedSource).toBe(2)
    expect(edge!.weight).toBeCloseTo(2 * SIGNAL_WEIGHTS.sharedSource, 9)
    // paper<->paper (same type) is not in the type-affinity table
    expect(edge!.signals.typeAffinity).toBe(0)
  })

  it("caps the shared-source signal at 3 even with 4 shared sources", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { sources: ["s1", "s2", "s3", "s4"] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { sources: ["s1", "s2", "s3", "s4", "s5"] }), "x"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const edge = edgeBetween(graph, "wiki/papers/p1", "wiki/papers/p2")
    expect(edge).toBeDefined()
    expect(edge!.signals.sharedSource).toBe(3)
    expect(edge!.weight).toBeCloseTo(3 * SIGNAL_WEIGHTS.sharedSource, 9)
  })
})

describe("adamicAdar", () => {
  it("matches a hand-computed value on a small known graph", async () => {
    // Graph (wikilink-derived, undirected):
    //   a - z1, a - z2, b - z1, b - z2, z1 - c
    // neighbor sets:
    //   N(a)  = {z1, z2}        deg(a)  = 2
    //   N(b)  = {z1, z2}        deg(b)  = 2
    //   N(z1) = {a, b, c}       deg(z1) = 3
    //   N(z2) = {a, b}          deg(z2) = 2
    //   N(c)  = {z1}            deg(c)  = 1
    //
    // Common neighbors of (a, b): {z1, z2}, both with degree >= 2, so both
    // contribute (c is not a common neighbor of a/b, and its own degree of
    // 1 would have been skipped anyway).
    //   AA(a, b) = 1/ln(deg(z1)) + 1/ln(deg(z2)) = 1/ln(3) + 1/ln(2)
    const bundle = await bundleFrom({
      "wiki/notes/a.md": [fm("note", "A"), "Links to [[z1]] and [[z2]]."],
      "wiki/notes/b.md": [fm("note", "B"), "Links to [[z1]] and [[z2]]."],
      "wiki/notes/z1.md": [fm("note", "Z1"), "Links to [[c]]."],
      "wiki/notes/z2.md": [fm("note", "Z2"), "leaf"],
      "wiki/notes/c.md": [fm("note", "C"), "leaf"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const edge = edgeBetween(graph, "wiki/notes/a", "wiki/notes/b")
    expect(edge).toBeDefined()
    const expectedAA = 1 / Math.log(3) + 1 / Math.log(2)
    expect(edge!.signals.adamicAdar).toBeCloseTo(expectedAA, 9)
    expect(edge!.signals.wikilink).toBe(0) // a and b are not directly linked
    expect(edge!.weight).toBeCloseTo(expectedAA * SIGNAL_WEIGHTS.adamicAdar, 9)
  })

  it("standalone adamicAdar() helper matches the same hand computation directly", () => {
    const neighbors = new Map<string, Set<string>>([
      ["a", new Set(["z1", "z2"])],
      ["b", new Set(["z1", "z2"])],
      ["z1", new Set(["a", "b", "c"])],
      ["z2", new Set(["a", "b"])],
      ["c", new Set(["z1"])],
    ])
    const expectedAA = 1 / Math.log(3) + 1 / Math.log(2)
    expect(adamicAdar(neighbors, "a", "b")).toBeCloseTo(expectedAA, 9)
    // Common neighbors of (z1, z2) are {a, b}, each with degree 2:
    //   AA(z1, z2) = 1/ln(2) + 1/ln(2) = 2/ln(2)
    expect(adamicAdar(neighbors, "z1", "z2")).toBeCloseTo(2 / Math.log(2), 9)
    // z2 and c share no common neighbor at all (N(z2)={a,b}, N(c)={z1})
    expect(adamicAdar(neighbors, "z2", "c")).toBe(0)
  })
})

describe("deriveKnowledgeGraph — type-affinity table", () => {
  it("assigns typeAffinity=1 for each documented affine pair, 0 otherwise", async () => {
    // Each namespace is an isolated wikilinked pair, so its edge's signals
    // are wikilink=1 (always) plus whatever typeAffinity the pair earns —
    // isolating the typeAffinity assertion from sharedSource/adamicAdar.
    const bundle = await bundleFrom({
      "wiki/t1/paper.md": [fm("paper", "Paper1"), "[[t1/concept]]"],
      "wiki/t1/concept.md": [fm("concept", "Concept1"), "leaf"],

      "wiki/t2/paper.md": [fm("paper", "Paper2"), "[[t2/method]]"],
      "wiki/t2/method.md": [fm("method", "Method2"), "leaf"],

      "wiki/t3/paper.md": [fm("paper", "Paper3"), "[[t3/finding]]"],
      "wiki/t3/finding.md": [fm("finding", "Finding3"), "leaf"],

      "wiki/t4/concept.md": [fm("concept", "Concept4"), "[[t4/topic]]"],
      "wiki/t4/topic.md": [fm("topic", "Topic4"), "leaf"],

      "wiki/t5/finding.md": [fm("finding", "Finding5"), "[[t5/comparison]]"],
      "wiki/t5/comparison.md": [fm("comparison", "Comparison5"), "leaf"],

      "wiki/t6/concept-a.md": [fm("concept", "ConceptA6"), "[[t6/concept-b]]"],
      "wiki/t6/concept-b.md": [fm("concept", "ConceptB6"), "leaf"],

      "wiki/t7/paper-a.md": [fm("paper", "PaperA7"), "[[t7/paper-b]]"],
      "wiki/t7/paper-b.md": [fm("paper", "PaperB7"), "leaf"],

      "wiki/t8/paper.md": [fm("paper", "Paper8"), "[[t8/topic]]"],
      "wiki/t8/topic.md": [fm("topic", "Topic8"), "leaf"],
    })
    const graph = deriveKnowledgeGraph(bundle)

    const affine: [string, string][] = [
      ["wiki/t1/paper", "wiki/t1/concept"],
      ["wiki/t2/paper", "wiki/t2/method"],
      ["wiki/t3/paper", "wiki/t3/finding"],
      ["wiki/t4/concept", "wiki/t4/topic"],
      ["wiki/t5/finding", "wiki/t5/comparison"],
      ["wiki/t6/concept-a", "wiki/t6/concept-b"],
    ]
    for (const [a, b] of affine) {
      const edge = edgeBetween(graph, a, b)
      expect(edge, `${a} <-> ${b}`).toBeDefined()
      expect(edge!.signals.typeAffinity, `${a} <-> ${b}`).toBe(1)
    }

    const nonAffine: [string, string][] = [
      ["wiki/t7/paper-a", "wiki/t7/paper-b"],
      ["wiki/t8/paper", "wiki/t8/topic"],
    ]
    for (const [a, b] of nonAffine) {
      const edge = edgeBetween(graph, a, b)
      expect(edge, `${a} <-> ${b}`).toBeDefined()
      expect(edge!.signals.typeAffinity, `${a} <-> ${b}`).toBe(0)
    }
  })
})

describe("deriveKnowledgeGraph — no-edge & degree", () => {
  it("an all-zero-signal pair gets no edge", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/a.md": [fm("note", "A"), "no links"],
      "wiki/notes/b.md": [fm("note", "B"), "no links"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    expect(graph.edges).toHaveLength(0)
    expect(graph.nodes).toHaveLength(2)
  })

  it("degree is the sum of incident edge weights", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/x.md": [fm("note", "X"), "Links to [[y]] and [[z]]."],
      "wiki/notes/y.md": [fm("paper", "Y", { sources: ["s1", "s2"] }), "leaf"],
      "wiki/notes/z.md": [fm("note", "Z"), "leaf"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    const xNode = graph.nodes.find((n) => n.id === "wiki/notes/x")!
    const xy = edgeBetween(graph, "wiki/notes/x", "wiki/notes/y")!
    const xz = edgeBetween(graph, "wiki/notes/x", "wiki/notes/z")!
    expect(xNode.degree).toBeCloseTo(xy.weight + xz.weight, 9)
  })
})

describe("deriveKnowledgeGraph — Louvain communities", () => {
  it("is deterministic across repeated derivations of the same bundle", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/a.md": [fm("note", "A"), "[[b]] [[c]]"],
      "wiki/notes/b.md": [fm("note", "B"), "[[c]]"],
      "wiki/notes/c.md": [fm("note", "C"), "leaf"],
      "wiki/notes/d.md": [fm("note", "D"), "[[e]] [[f]]"],
      "wiki/notes/e.md": [fm("note", "E"), "[[f]]"],
      "wiki/notes/f.md": [fm("note", "F"), "leaf"],
    })
    const g1 = deriveKnowledgeGraph(bundle)
    const g2 = deriveKnowledgeGraph(bundle)
    const communityMap = (g: typeof g1) =>
      Object.fromEntries(g.nodes.map((n) => [n.id, n.community]))
    expect(communityMap(g1)).toEqual(communityMap(g2))
    expect(g1.communities).toBe(g2.communities)
  })

  it("single-node graph gets community 0, no crash", async () => {
    const bundle = await bundleFrom({
      "wiki/notes/lonely.md": [fm("note", "Lonely"), "no links at all"],
    })
    const graph = deriveKnowledgeGraph(bundle)
    expect(graph.nodes).toEqual([
      expect.objectContaining({ id: "wiki/notes/lonely", community: 0, degree: 0 }),
    ])
    expect(graph.edges).toHaveLength(0)
  })

  it("empty bundle -> empty graph, no crash", async () => {
    const bundle = await bundleFrom({})
    const graph = deriveKnowledgeGraph(bundle)
    expect(graph).toEqual({ nodes: [], edges: [], communities: 0 })
  })
})
