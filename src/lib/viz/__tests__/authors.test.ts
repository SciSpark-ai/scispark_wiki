import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { serializeDocument } from "../../vault/frontmatter"
import { loadBundle } from "../../vault/bundle"
import type { Frontmatter } from "../../vault/types"
import { deriveAuthorNetwork } from "../authors"

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

function edgeBetween(network: ReturnType<typeof deriveAuthorNetwork>, a: string, b: string) {
  return network.edges.find(
    (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
  )
}

describe("deriveAuthorNetwork — co-author pairs", () => {
  it("a 3-author paper produces 3 pairwise edges, each with papers=1", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["Alice", "Bob", "Carol"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    expect(network.edges).toHaveLength(3)
    for (const e of network.edges) expect(e.papers).toBe(1)
    expect(edgeBetween(network, "alice", "bob")).toBeDefined()
    expect(edgeBetween(network, "alice", "carol")).toBeDefined()
    expect(edgeBetween(network, "bob", "carol")).toBeDefined()
  })

  it("no self-edges even if a name is repeated within one paper's author list", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["Alice", "Alice"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    expect(network.edges).toHaveLength(0)
    const alice = network.nodes.find((n) => n.key === "alice")!
    expect(alice.paperCount).toBe(1)
  })

  it("repeat co-authorship across papers increments the edge's papers count", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["Alice", "Bob"] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { authors: ["Alice", "Bob"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    const edge = edgeBetween(network, "alice", "bob")!
    expect(edge.papers).toBe(2)
    const alice = network.nodes.find((n) => n.key === "alice")!
    expect(alice.paperCount).toBe(2)
  })
})

describe("deriveAuthorNetwork — name normalization", () => {
  it("'A. B.' and 'a. b.' collapse to the same author node", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["A. B.", "Zed"] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { authors: ["a. b.", "Zed"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    const abNodes = network.nodes.filter((n) => n.key === "a. b.")
    expect(abNodes).toHaveLength(1)
    expect(abNodes[0].paperCount).toBe(2)
    // display name keeps the first-seen casing
    expect(abNodes[0].name).toBe("A. B.")
    const edge = edgeBetween(network, "a. b.", "zed")!
    expect(edge.papers).toBe(2)
  })

  it("normalizes stray/extra whitespace into the same key", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["  Alice   Smith "] }), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { authors: ["Alice Smith"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    const node = network.nodes.find((n) => n.key === "alice smith")!
    expect(node.paperCount).toBe(2)
  })
})

describe("deriveAuthorNetwork — author page matching", () => {
  it("links pageId when a type:author page's title normalizes to the same key", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["Alice Smith"] }), "x"],
      "wiki/authors/alice-smith.md": [fm("author", "Alice Smith"), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    const node = network.nodes.find((n) => n.key === "alice smith")!
    expect(node.pageId).toBe("wiki/authors/alice-smith")
  })

  it("pageId is null when no matching author page exists", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1", { authors: ["Nobody Notable"] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    const node = network.nodes.find((n) => n.key === "nobody notable")!
    expect(node.pageId).toBeNull()
  })
})

describe("deriveAuthorNetwork — tolerance and empty inputs", () => {
  it("skips paper pages with missing or non-array authors", async () => {
    const bundle = await bundleFrom({
      "wiki/papers/p1.md": [fm("paper", "P1"), "x"],
      "wiki/papers/p2.md": [fm("paper", "P2", { authors: "not-an-array" as unknown as string[] }), "x"],
    })
    const network = deriveAuthorNetwork(bundle)
    expect(network.nodes).toHaveLength(0)
    expect(network.edges).toHaveLength(0)
  })

  it("empty bundle -> empty nodes/edges", async () => {
    const bundle = await bundleFrom({})
    const network = deriveAuthorNetwork(bundle)
    expect(network).toEqual({ nodes: [], edges: [] })
  })
})
