// SP2.1 seam guard: nodeSearchFn must thread the SearchOpts date window into
// each adapter's own mechanism (arXiv fromDate → submittedDate range,
// OpenAlex fromDate → from_publication_date filter). A silently dropped
// option here would make the feed's freshness window a no-op with zero test
// failures anywhere else — the adapters are mocked, so this tests exactly
// the threading and nothing about the adapters themselves.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockSearchArxiv, mockSearchOpenAlex, mockSearchS2, mockSearchPubmed } = vi.hoisted(() => ({
  mockSearchArxiv: vi.fn<(q: unknown) => Promise<unknown[]>>(async () => []),
  mockSearchOpenAlex: vi.fn<(q: unknown, deps?: unknown) => Promise<unknown[]>>(async () => []),
  mockSearchS2: vi.fn<(q: unknown, deps?: unknown) => Promise<unknown[]>>(async () => []),
  mockSearchPubmed: vi.fn<(q: unknown, deps?: unknown) => Promise<unknown[]>>(async () => []),
}))
vi.mock("../arxiv", () => ({ searchArxiv: mockSearchArxiv }))
vi.mock("../s2", () => ({ searchS2: mockSearchS2 }))
vi.mock("../pubmed", () => ({ searchPubmed: mockSearchPubmed }))
vi.mock("../openalex", () => ({
  searchOpenAlex: mockSearchOpenAlex,
  countOpenAlexWorks: vi.fn(),
  groupWorksByTopic: vi.fn(),
  groupWorksByTopicField: vi.fn(),
}))

import { nodeFeedSearchFn, nodeResearchSearchFn, nodeSearchFn } from "../node-search"

describe("nodeSearchFn", () => {
  beforeEach(() => {
    mockSearchArxiv.mockClear()
    mockSearchOpenAlex.mockClear()
    mockSearchS2.mockClear()
    mockSearchPubmed.mockClear()
  })

  it("threads fromDate to the arXiv adapter", async () => {
    await nodeSearchFn()("arxiv", "ear eeg", 25, { fromDate: "2026-07-05" })
    expect(mockSearchArxiv).toHaveBeenCalledWith({ query: "ear eeg", limit: 25, fromDate: "2026-07-05" })
  })

  it("threads fromDate to the OpenAlex adapter (and for remapped s2/pubmed sources)", async () => {
    await nodeSearchFn()("openalex", "ear eeg", 25, { fromDate: "2026-07-05" })
    await nodeSearchFn()("pubmed", "ear eeg", 25, { fromDate: "2026-07-05" })
    for (const call of mockSearchOpenAlex.mock.calls) {
      expect(call[0]).toEqual({ query: "ear eeg", limit: 25, fromDate: "2026-07-05" })
    }
    expect(mockSearchOpenAlex).toHaveBeenCalledTimes(2)
  })

  it("omitting opts leaves fromDate undefined for both adapters (prior behavior preserved)", async () => {
    await nodeSearchFn()("arxiv", "q", 10)
    await nodeSearchFn()("openalex", "q", 10)
    expect(mockSearchArxiv.mock.calls[0][0]).toEqual({ query: "q", limit: 10, fromDate: undefined })
    expect(mockSearchOpenAlex.mock.calls[0][0]).toEqual({ query: "q", limit: 10, fromDate: undefined })
  })
})

describe("nodeResearchSearchFn", () => {
  beforeEach(() => {
    mockSearchArxiv.mockClear()
    mockSearchOpenAlex.mockClear()
    mockSearchS2.mockClear()
    mockSearchPubmed.mockClear()
  })

  it("preserves each selected scholarly source instead of remapping it", async () => {
    const search = nodeResearchSearchFn()
    await search("arxiv", "query a", 12, { fromDate: "2024-09-04", sort: "date" })
    await search("openalex", "query b", 12, { fromDate: "2024-09-04", sort: "date" })
    await search("s2", "query c", 12)
    await search("pubmed", "query d", 12)

    expect(mockSearchArxiv).toHaveBeenCalledWith({ query: "query a", limit: 12, fromDate: "2024-09-04", sort: "date" })
    expect(mockSearchOpenAlex.mock.calls[0][0]).toEqual({ query: "query b", limit: 12, fromDate: "2024-09-04", sort: "date" })
    expect(mockSearchS2.mock.calls[0][0]).toEqual({ query: "query c", limit: 12 })
    expect(mockSearchPubmed.mock.calls[0][0]).toEqual({ query: "query d", limit: 12 })
  })
})

describe("nodeFeedSearchFn", () => {
  it("preserves all four sources and forwards native date bounds", async () => {
    for (const mock of [mockSearchArxiv, mockSearchOpenAlex, mockSearchS2, mockSearchPubmed]) mock.mockClear()
    const search = nodeFeedSearchFn()
    for (const source of ["arxiv", "openalex", "s2", "pubmed"] as const) await search(source, "attention", 25, { fromDate: "2026-08-21", sort: "relevance" })
    for (const mock of [mockSearchArxiv, mockSearchOpenAlex, mockSearchS2, mockSearchPubmed]) {
      expect(mock).toHaveBeenCalledTimes(1)
      expect(mock.mock.calls[0][0]).toMatchObject({ query: "attention", limit: 25, fromDate: "2026-08-21" })
    }
  })
  it("propagates source failures so the pipeline can report partial coverage", async () => {
    mockSearchS2.mockRejectedValueOnce(new Error("rate limited"))
    await expect(nodeFeedSearchFn()("s2", "attention", 25)).rejects.toThrow("rate limited")
  })
})
