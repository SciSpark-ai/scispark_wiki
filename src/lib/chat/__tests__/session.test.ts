import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { CHATS_DIR, deriveTitle, makeSessionId, loadSession, saveSession, listSessions } from "../session"
import type { ChatSession } from "../session"

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "chat_1",
    title: "A question about diffusion models",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    messages: [
      { role: "user", content: "What is a diffusion model?" },
      { role: "assistant", content: "It is a generative model.", citedPageIds: ["diffusion-model"] },
    ],
    ...overrides,
  }
}

describe("makeSessionId", () => {
  it("is deterministic for a given Date", () => {
    const now = new Date("2026-07-20T00:00:00.000Z")
    expect(makeSessionId(now)).toBe(makeSessionId(now))
  })

  it("differs for different Dates", () => {
    expect(makeSessionId(new Date("2026-07-20T00:00:00.000Z"))).not.toBe(
      makeSessionId(new Date("2026-07-21T00:00:00.000Z")),
    )
  })
})

describe("saveSession / loadSession round-trip", () => {
  it("round-trips a session", async () => {
    const storage = new MemoryVaultStorage()
    const session = makeSession()
    await saveSession(storage, session)
    const loaded = await loadSession(storage, session.id)
    expect(loaded).toEqual(session)
  })

  it("writes under CHATS_DIR", async () => {
    const storage = new MemoryVaultStorage()
    const session = makeSession()
    await saveSession(storage, session)
    const files = await storage.list(CHATS_DIR)
    expect(files.length).toBe(1)
    expect(files[0].startsWith(CHATS_DIR)).toBe(true)
  })

  it("returns null for a missing session", async () => {
    const storage = new MemoryVaultStorage()
    expect(await loadSession(storage, "does-not-exist")).toBeNull()
  })

  it("returns null for unparseable JSON", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(`${CHATS_DIR}/broken.json`, "{ not json")
    expect(await loadSession(storage, "broken")).toBeNull()
  })

  it("returns null when the payload is missing messages", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(`${CHATS_DIR}/partial.json`, JSON.stringify({ id: "partial" }))
    expect(await loadSession(storage, "partial")).toBeNull()
  })

  it("returns null when the payload is missing id", async () => {
    const storage = new MemoryVaultStorage()
    await storage.write(`${CHATS_DIR}/noid.json`, JSON.stringify({ messages: [] }))
    expect(await loadSession(storage, "noid")).toBeNull()
  })
})

describe("listSessions", () => {
  it("skips a corrupt file and still returns the healthy ones, newest first", async () => {
    const storage = new MemoryVaultStorage()
    const older = makeSession({ id: "chat_1", updatedAt: "2026-07-18T00:00:00.000Z" })
    const newer = makeSession({ id: "chat_2", updatedAt: "2026-07-20T00:00:00.000Z" })
    await saveSession(storage, older)
    await saveSession(storage, newer)
    await storage.write(`${CHATS_DIR}/corrupt.json`, "{ not json")

    const sessions = await listSessions(storage)
    expect(sessions.map((s) => s.id)).toEqual(["chat_2", "chat_1"])
  })

  it("returns an empty list when there are no sessions", async () => {
    const storage = new MemoryVaultStorage()
    expect(await listSessions(storage)).toEqual([])
  })
})

describe("deriveTitle", () => {
  it("passes short input through unchanged", () => {
    expect(deriveTitle("What is a diffusion model?")).toBe("What is a diffusion model?")
  })

  it("collapses internal whitespace", () => {
    expect(deriveTitle("What   is\n\na  diffusion   model?")).toBe("What is a diffusion model?")
  })

  it("trims leading/trailing whitespace", () => {
    expect(deriveTitle("   hello world   ")).toBe("hello world")
  })

  it("cuts at a word boundary to at most 60 characters and appends an ellipsis", () => {
    const long =
      "Can you explain in detail how diffusion models differ from autoregressive language models in terms of training objectives"
    const title = deriveTitle(long)
    expect(title.length).toBeLessThanOrEqual(61) // 60 chars + ellipsis
    expect(title.endsWith("…")).toBe(true)
    expect(title.length === 1 || title[title.length - 2] !== " ").toBe(true)
    expect(long.startsWith(title.slice(0, -1).trimEnd())).toBe(true)
  })

  it("returns 'Untitled chat' for empty input", () => {
    expect(deriveTitle("")).toBe("Untitled chat")
  })

  it("returns 'Untitled chat' for whitespace-only input", () => {
    expect(deriveTitle("   \n\t  ")).toBe("Untitled chat")
  })
})
