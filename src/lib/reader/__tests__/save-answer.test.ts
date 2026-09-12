import { afterEach, expect, it } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle } from "../../vault/bundle"
import { undoChangeset } from "../../vault/mutations"
import { setServerVaultForTests } from "../../server/vault"
import { POST } from "../../../app/api/skills/ask/save/route"

afterEach(() => setServerVaultForTests(null))
const input = { question: "What is alpha power?", answer: "An AI explanation, with uncertainty preserved.",
  selection: "EEG alpha power", paperKey: "doi:10.1234/test", paperTitle: "Attention study",
  citedPageIds: ["wiki/papers/attention", "wiki/concepts/eeg"] }
const request = (data: unknown, origin = "http://localhost:3000") => new Request("http://localhost:3000/api/skills/ask/save", {
  method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json" }, body: JSON.stringify(data),
})

it("saves a sourced wiki answer through the API, updates the index, and supports undo", async () => {
  const storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  const response = await POST(request(input))
  expect(response.status).toBe(200)
  const { result } = await response.json()
  const page = (await loadBundle(storage)).pages.get(result.pageId)!
  expect(page.frontmatter.sources).toEqual(["paper:doi:10.1234/test", "question:What is alpha power?"])
  expect(page.frontmatter.related).toEqual(["attention", "eeg"])
  expect(page.body).toContain("> EEG alpha power")
  expect(page.body).toContain(input.answer)
  expect(page.body).toContain("AI-generated reading explanation")
  expect(page.body).toContain(input.paperTitle)
  expect(await storage.read("index.md")).toContain("what-is-alpha-power")
  await undoChangeset(storage, result.changesetId)
  expect(await storage.read(`${result.pageId}.md`)).toBeNull()
})

it("rejects empty answers and cross-origin saves before writing", async () => {
  const storage = new MemoryVaultStorage()
  setServerVaultForTests(storage)
  expect((await POST(request({ ...input, answer: "" }))).status).toBe(400)
  expect((await POST(request(input, "https://example.com"))).status).toBe(403)
  expect(await storage.list("")).toEqual([])
})
