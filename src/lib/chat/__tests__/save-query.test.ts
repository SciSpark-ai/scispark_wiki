import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { loadBundle } from "../../vault/bundle"
import { loadChangeset } from "../../vault/changesets"
import { loadRouting } from "../../wiki/schema-routing"
import { parseDocument, serializeDocument } from "../../vault/frontmatter"
import { saveAnswerAsQuery } from "../save-query"

const BASE_OPTS = {
  question: "What is a diffusion model?",
  answer: "A diffusion model is a generative model that learns to reverse a noising process.",
  sessionId: "chat_123",
  citedPageIds: ["wiki/papers/diffusion-model", "wiki/concepts/noising-process"],
  today: "2026-07-26",
}

describe("saveAnswerAsQuery", () => {
  it("writes a query page at the routed path with the expected frontmatter and body", async () => {
    const storage = new MemoryVaultStorage()
    const { changesetId, pageId } = await saveAnswerAsQuery(storage, BASE_OPTS)

    expect(pageId).toBe("wiki/queries/what-is-a-diffusion-model")
    expect(changesetId).toBeTruthy()

    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(pageId)
    expect(page).toBeDefined()
    expect(page!.frontmatter.type).toBe("query")
    expect(page!.frontmatter.title).toBe(BASE_OPTS.question)
    expect(page!.frontmatter.created).toBe("2026-07-26")
    expect(page!.frontmatter.updated).toBe("2026-07-26")
    expect(page!.frontmatter.tags).toEqual([])
    expect(page!.frontmatter.sources).toEqual([`chat:chat_123`, `question:${BASE_OPTS.question}`])

    expect(page!.body).toContain(BASE_OPTS.question)
    expect(page!.body).toContain(BASE_OPTS.answer)
  })

  it("maps citedPageIds (full bundle ids) down to bare slugs in related[]", async () => {
    const storage = new MemoryVaultStorage()
    const { pageId } = await saveAnswerAsQuery(storage, BASE_OPTS)

    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(pageId)
    expect(page!.frontmatter.related).toEqual(["diffusion-model", "noising-process"])
  })

  it("a second save of the same question creates a distinct page, never clobbering the first", async () => {
    const storage = new MemoryVaultStorage()
    const first = await saveAnswerAsQuery(storage, BASE_OPTS)
    const second = await saveAnswerAsQuery(storage, {
      ...BASE_OPTS,
      answer: "A different answer the second time around.",
    })

    expect(second.pageId).not.toBe(first.pageId)
    expect(second.pageId).toBe("wiki/queries/what-is-a-diffusion-model-2")

    const bundle = await loadBundle(storage)
    expect(bundle.pages.has(first.pageId)).toBe(true)
    expect(bundle.pages.has(second.pageId)).toBe(true)
    expect(bundle.pages.get(first.pageId)!.body).toContain(BASE_OPTS.answer)
    expect(bundle.pages.get(second.pageId)!.body).toContain("A different answer the second time around.")
  })

  it("a third save suffixes -3, not re-using -2", async () => {
    const storage = new MemoryVaultStorage()
    await saveAnswerAsQuery(storage, BASE_OPTS)
    await saveAnswerAsQuery(storage, BASE_OPTS)
    const third = await saveAnswerAsQuery(storage, BASE_OPTS)

    expect(third.pageId).toBe("wiki/queries/what-is-a-diffusion-model-3")
  })

  it("applies as a changeset whose record supports the existing revert path", async () => {
    const storage = new MemoryVaultStorage()
    const { changesetId, pageId } = await saveAnswerAsQuery(storage, BASE_OPTS)

    const cs = await loadChangeset(storage, changesetId)
    expect(cs).not.toBeNull()
    expect(cs!.changes).toEqual([
      { path: `${pageId}.md`, before: null, after: (await storage.read(`${pageId}.md`)) },
    ])
  })

  it("adds the page to index.md and appends a log line", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write("index.md", "# Index\n")
    await storage.write("log.md", "# Log\n")

    const { pageId } = await saveAnswerAsQuery(storage, BASE_OPTS)

    const index = await storage.read("index.md")
    expect(index).toContain(`[[${pageId.split("/").pop()}]]`)
    expect(index).toContain(BASE_OPTS.question)

    const log = await storage.read("log.md")
    expect(log).toContain(pageId)
  })

  it("honours a custom schema.md routing for the query type", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write("schema.md", "## Page Types\n\n| query | wiki/saved-answers |\n")
    expect((await loadRouting(storage))["query"]).toBe("wiki/saved-answers")

    const { pageId } = await saveAnswerAsQuery(storage, BASE_OPTS)
    expect(pageId).toBe("wiki/saved-answers/what-is-a-diffusion-model")

    const bundle = await loadBundle(storage)
    expect(bundle.pages.has(pageId)).toBe(true)
  })

  it("falls back to the current date when today is omitted", async () => {
    const storage = new MemoryVaultStorage()
    const { pageId } = await saveAnswerAsQuery(storage, {
      question: "No explicit date",
      answer: "answer",
      sessionId: "chat_1",
      citedPageIds: [],
    })
    const bundle = await loadBundle(storage)
    const page = bundle.pages.get(pageId)
    expect(page!.frontmatter.created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("handles no cited pages (empty related[])", async () => {
    const storage = new MemoryVaultStorage()
    const { pageId } = await saveAnswerAsQuery(storage, { ...BASE_OPTS, citedPageIds: [] })
    const bundle = await loadBundle(storage)
    expect(bundle.pages.get(pageId)!.frontmatter.related).toEqual([])
  })

  // A question is free text, so it can carry the two characters most likely to
  // corrupt a `sources[]` entry: a newline (which would read back as extra
  // content glued onto the entry) and a colon (which YAML can read as a
  // key/value separator). `singleLine` collapses the newline; this pins that
  // the entry survives a real serialize -> parse round trip either way.
  it("keeps a newline-and-colon question intact through a serialize/parse round trip", async () => {
    const storage = new MemoryVaultStorage()
    const question = "What is attention:\nand why does it matter?"
    const { pageId } = await saveAnswerAsQuery(storage, { ...BASE_OPTS, question })

    const raw = await storage.read(`${pageId}.md`)
    expect(raw).not.toBeNull()

    // Round-trip through the real frontmatter layer, not the bundle loader.
    const reparsed = parseDocument(serializeDocument(parseDocument(raw!).frontmatter, parseDocument(raw!).body))

    const sources = reparsed.frontmatter.sources as string[]
    expect(sources).toHaveLength(2)
    expect(sources[0]).toBe("chat:chat_123")
    // Collapsed to one line, colon preserved, and still exactly one entry.
    expect(sources[1]).toBe("question:What is attention: and why does it matter?")
    expect(sources[1]).not.toContain("\n")
  })

  // The session id reaches this function straight from a request body, so it is
  // no more trustworthy than the question and gets the same `singleLine`
  // treatment — otherwise a newline in it smears the frontmatter list entry,
  // the exact failure `singleLine` exists to prevent.
  it("collapses a whitespace-carrying session id into one sources[] entry", async () => {
    const storage = new MemoryVaultStorage()
    const { pageId } = await saveAnswerAsQuery(storage, { ...BASE_OPTS, sessionId: " chat_1\nevil: true " })

    const raw = await storage.read(`${pageId}.md`)
    const reparsed = parseDocument(serializeDocument(parseDocument(raw!).frontmatter, parseDocument(raw!).body))

    const sources = reparsed.frontmatter.sources as string[]
    expect(sources).toHaveLength(2)
    expect(sources[0]).toBe("chat:chat_1 evil: true")
    expect(sources[0]).not.toContain("\n")
  })
})
