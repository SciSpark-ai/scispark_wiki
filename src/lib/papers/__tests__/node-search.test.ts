// SP2.1 seam guard: nodeSearchFn must thread the SearchOpts date window into
// each adapter's own mechanism (arXiv fromDate → submittedDate range,
// OpenAlex fromDate → from_publication_date filter). A silently dropped
// option here would make the feed's freshness window a no-op with zero test
// failures anywhere else — the adapters are mocked, so this tests exactly
// the threading and nothing about the adapters themselves.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockSearchArxiv, mockSearchOpenAlex } = vi.hoisted(() => ({
  mockSearchArxiv: vi.fn<(q: unknown) => Promise<unknown[]>>(async () => []),
  mockSearchOpenAlex: vi.fn<(q: unknown, deps?: unknown) => Promise<unknown[]>>(async () => []),
}))
vi.mock("../arxiv", () => ({ searchArxiv: mockSearchArxiv }))
vi.mock("../openalex", () => ({
  searchOpenAlex: mockSearchOpenAlex,
  countOpenAlexWorks: vi.fn(),
  groupWorksByTopic: vi.fn(),
  groupWorksByTopicField: vi.fn(),
}))

import { nodeSearchFn } from "../node-search"

describe("nodeSearchFn", () => {
  beforeEach(() => {
    mockSearchArxiv.mockClear()
    mockSearchOpenAlex.mockClear()
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
