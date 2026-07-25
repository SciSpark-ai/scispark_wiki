import { describe, it, expect, vi } from "vitest"
import { groupWorksByTopic, groupWorksByTopicField } from "../openalex"

function fetchReturning(body: unknown) {
  return vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
    async () => new Response(JSON.stringify(body), { status: 200 }),
  )
}

describe("groupWorksByTopic", () => {
  it("requests group_by=primary_topic.id with the date range and maps entries", async () => {
    const fetchFn = fetchReturning({
      group_by: [
        { key: "https://openalex.org/T10123", key_display_name: "Auditory Perception", count: 42 },
        { key: "https://openalex.org/T10456", key_display_name: "Speech Processing", count: 17 },
      ],
    })
    const out = await groupWorksByTopic(
      { query: "neuroscience", fromDate: "2026-07-06", toDate: "2026-07-19" },
      { fetchFn },
    )
    const url = String(fetchFn.mock.calls[0][0])
    expect(url).toContain("group_by=primary_topic.id")
    expect(url).toContain("from_publication_date%3A2026-07-06")
    expect(url).toContain("to_publication_date%3A2026-07-19")
    expect(out).toEqual([
      { key: "https://openalex.org/T10123", label: "Auditory Perception", count: 42 },
      { key: "https://openalex.org/T10456", label: "Speech Processing", count: 17 },
    ])
  })

  it("drops the unknown bucket and entries with no display name", async () => {
    const fetchFn = fetchReturning({
      group_by: [
        { key: "unknown", key_display_name: "unknown", count: 99 },
        { key: "https://openalex.org/T1", count: 5 },
        { key: "https://openalex.org/T2", key_display_name: "Real Topic", count: 3 },
      ],
    })
    const out = await groupWorksByTopic({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn })
    expect(out).toEqual([{ key: "https://openalex.org/T2", label: "Real Topic", count: 3 }])
  })

  it("returns [] when the response has no group_by array", async () => {
    const fetchFn = fetchReturning({})
    const out = await groupWorksByTopic({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn })
    expect(out).toEqual([])
  })

  /**
   * buildUrl invariants for EVERY grouped request, inherited from the deleted
   * `groupWorksByPublicationDate` tests (that grouping is now rejected by
   * OpenAlex and the helper is gone, but these guards are about buildUrl, not
   * about which field is grouped). A `sort` on a grouped query is
   * ignored/rejected by OpenAlex — buildUrl's `else if` is what prevents it —
   * and a grouped request must ask for the full 200-bucket page.
   */
  it("never sends sort on a grouped request, and asks for per_page=200", async () => {
    const fetchFn = fetchReturning({ group_by: [] })
    await groupWorksByTopic({ query: "x", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn })
    const url = new URL(String(fetchFn.mock.calls[0][0]))
    expect(url.searchParams.get("sort")).toBeNull()
    expect(url.searchParams.get("per_page")).toBe("200")
  })
})

describe("groupWorksByTopicField", () => {
  it("requests group_by=primary_topic.field.id", async () => {
    const fetchFn = fetchReturning({
      group_by: [{ key: "https://openalex.org/fields/28", key_display_name: "Neuroscience", count: 88 }],
    })
    const out = await groupWorksByTopicField({ query: "eeg", fromDate: "2026-07-06", toDate: "2026-07-19" }, { fetchFn })
    expect(String(fetchFn.mock.calls[0][0])).toContain("group_by=primary_topic.field.id")
    expect(out).toEqual([{ key: "https://openalex.org/fields/28", label: "Neuroscience", count: 88 }])
  })
})
