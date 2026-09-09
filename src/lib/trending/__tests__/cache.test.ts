import { it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DASHBOARD_CACHE_PATH, loadBoard, loadTrendingPaperRecords } from "../cache"

it("invalidates old keyword-scoped metrics without losing their paper records", async () => {
  const storage = new MemoryVaultStorage()
  const record = { source: "openalex", ids: { openalex: "W1" }, title: "Hearing speech in noise", authors: [], fields: [] }
  await storage.write(DASHBOARD_CACHE_PATH, JSON.stringify({
    version: 4, generatedAt: "2026-09-06T00:00:00Z",
    topics: [{ papers: [{ record }, { record: { title: "Corrupt" } }] }], breakouts: [],
  }))
  expect(await loadBoard(storage)).toBeNull()
  expect(await loadTrendingPaperRecords(storage)).toEqual([record])
})
