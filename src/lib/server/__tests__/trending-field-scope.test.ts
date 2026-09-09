import { it, expect, afterEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import { setSkillTestOverrides } from "../skill-route"
import { MockProvider } from "../../llm/mock-provider"
import { saveTrendingSettings } from "../../trending/settings"
import { groupWorksByTopic, countOpenAlexWorks, searchTopCitedWorks } from "../../papers/openalex"
import { readNdjson } from "../ndjson"
import type { TrendingBoard } from "../../trending/types"
import { POST } from "../../../app/api/skills/trending/refresh/route"

afterEach(() => { setServerVaultForTests(null); setSkillTestOverrides() })

it.each([undefined, ["2805", "2809"]])("threads field and optional subfields %j through every metric and paper query", async (subfieldIds) => {
  const storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  await saveTrendingSettings(storage, {
    fields: [], cadence: "weekly", anchors: [{ id: "28", label: "untrusted label", subfieldIds }], anchorsOverridden: true,
  })
  const urls: URL[] = []
  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(String(input)); urls.push(url)
    const filters = url.searchParams.get("filter") ?? ""
    const body = url.searchParams.has("group_by")
      ? { group_by: [{ key: "T1", key_display_name: "Auditory attention", count: 40 }] }
      : { meta: { count: filters.includes("primary_topic.id:") ? 10 : 1000 }, results: [{
        id: "https://openalex.org/W123", display_name: "Hearing speech in noise",
        publication_date: "2026-08-25", publication_year: 2026, cited_by_count: 3,
        authorships: [], topics: [], type: "article",
      }] }
    return Response.json(body)
  }
  const provider = new MockProvider([{
    text: JSON.stringify({ topics: [{ key: "T1", why: "Attention research." }], crossDisciplineNote: "Fixture." }),
    usage: { inputTokens: 10, outputTokens: 10 }, model: "fixture", provider: "openai", stopReason: "end_turn",
  }])
  setSkillTestOverrides({
    providerOverride: { strong: provider },
    fieldGroupFn: async () => { throw new Error("Manual fields must not be derived") },
    topicGroupFn: (q) => groupWorksByTopic(q, { fetchFn }),
    countFn: (q) => countOpenAlexWorks(q, { fetchFn }),
    topWorksFn: (q) => searchTopCitedWorks(q, { fetchFn }),
  })
  const response = await POST(new Request("http://localhost/api/skills/trending/refresh", {
    method: "POST", body: JSON.stringify({ fields: [] }),
  }))
  const board = await readNdjson(response, () => {}) as TrendingBoard
  expect(board.anchors).toEqual([{ id: "https://openalex.org/fields/28", label: "Neuroscience",
    ...(subfieldIds ? { subfieldIds: subfieldIds.map((id) => "https://openalex.org/subfields/" + id) } : {}),
  }])
  expect(board.topics[0].papers[0].record.title).toBe("Hearing speech in noise")
  expect(board.topics[0].recentCount).toBe(40)
  expect(board.topics[0].priorCount).toBe(10)
  expect(board.overview.totalRecent).toBe(1000)
  expect(urls.length).toBeGreaterThanOrEqual(6)
  for (const url of urls) {
    expect(url.searchParams.has("search")).toBe(false)
    expect(url.searchParams.get("filter")).toContain("primary_topic.field.id:28")
    expect(url.searchParams.get("filter")).toContain("is_paratext:false")
    if (subfieldIds) expect(url.searchParams.get("filter")).toContain("primary_topic.subfield.id:2805|2809")
    else expect(url.searchParams.get("filter")).not.toContain("primary_topic.subfield.id")
  }
  const papers = urls.filter((url) => url.searchParams.get("sort") === "cited_by_count:desc")
  expect(papers).toHaveLength(2)
  expect(papers.some((url) => url.searchParams.get("filter")?.includes("primary_topic.id:T1"))).toBe(true)
})
