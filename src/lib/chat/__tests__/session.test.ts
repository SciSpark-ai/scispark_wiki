import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
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

  it("mints ids that are accepted as paths", async () => {
    const storage = new MemoryVaultStorage()
    const id = makeSessionId(new Date("2026-07-20T00:00:00.000Z"))
    // The suffixing `mintSessionId` applies on collision must survive too.
    for (const candidate of [id, `${id}-2`, `${id}-10`]) {
      await expect(saveSession(storage, makeSession({ id: candidate }))).resolves.toBeUndefined()
    }
  })
})

/**
 * A session id reaches `sessionPath` straight from a request body, so an
 * unvalidated one is a path-traversal WRITE primitive: `NodeFsVaultStorage`
 * only rejects paths escaping the vault ROOT, and `.scispark/chats/../settings.json`
 * lands INSIDE the root — on the BYOK key file `/api/vault/file` deliberately
 * 403s. These run against the REAL storage class, not the in-memory one, since
 * that resolution behaviour is exactly what's under test.
 */
describe("session id path validation", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "scispark-chat-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const SETTINGS_JSON = JSON.stringify({ llm: { keys: { anthropic: "sk-secret" } }, ui: { theme: "dark" } }, null, 2)

  function seedSettings(): string {
    mkdirSync(join(dir, ".scispark"), { recursive: true })
    const path = join(dir, ".scispark", "settings.json")
    writeFileSync(path, SETTINGS_JSON, "utf8")
    return path
  }

  it("saveSession rejects a traversing id and leaves settings.json byte-identical", async () => {
    const settingsPath = seedSettings()
    const storage = new NodeFsVaultStorage(dir)

    await expect(
      saveSession(storage, {
        id: "../settings",
        title: "t",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z",
        messages: [],
      }),
    ).rejects.toThrow(/invalid session id/)

    expect(readFileSync(settingsPath, "utf8")).toBe(SETTINGS_JSON)
  })

  it("loadSession rejects a traversing id rather than reading an arbitrary vault file", async () => {
    seedSettings()
    const storage = new NodeFsVaultStorage(dir)
    await expect(loadSession(storage, "../settings")).rejects.toThrow(/invalid session id/)
  })

  it("rejects every other id shape that isn't [A-Za-z0-9_-]+", async () => {
    const storage = new MemoryVaultStorage()
    for (const bad of ["", "a/b", "..", "./x", "a b", "x.json", "..%2Fsettings"]) {
      await expect(loadSession(storage, bad)).rejects.toThrow(/invalid session id/)
    }
  })

  it("listSessions skips a file whose name isn't a valid id instead of throwing", async () => {
    const storage = new MemoryVaultStorage()
    await saveSession(storage, makeSession({ id: "chat_1" }))
    await storage.write(`${CHATS_DIR}/weird name.json`, JSON.stringify(makeSession({ id: "weird name" })))

    const sessions = await listSessions(storage)
    expect(sessions.map((s) => s.id)).toEqual(["chat_1"])
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

  it("round-trips optional project snapshots and truncated context ids", async () => {
    const storage = new MemoryVaultStorage()
    const session = makeSession({
      projectId: "auditory-biomarkers",
      projectTitle: "Auditory Biomarkers",
      messages: [
        { role: "user", content: "Summarize the project." },
        {
          role: "assistant",
          content: "Summary.",
          truncatedPageIds: ["wiki/notes/long-note"],
        },
      ],
    })
    await saveSession(storage, session)
    await expect(loadSession(storage, session.id)).resolves.toEqual(session)
  })

  it("rejects partial project snapshots and malformed truncation metadata", async () => {
    const storage = new MemoryVaultStorage()
    const malformed = [
      { ...makeSession({ id: "project-without-title" }), projectId: "auditory" },
      { ...makeSession({ id: "title-without-project" }), projectTitle: "Auditory" },
      {
        ...makeSession({ id: "bad-truncation" }),
        messages: [{ role: "assistant", content: "x", truncatedPageIds: [7] }],
      },
    ]
    for (const value of malformed) {
      await storage.write(`${CHATS_DIR}/${value.id}.json`, JSON.stringify(value))
      await expect(loadSession(storage, value.id)).resolves.toBeNull()
    }
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

  it("returns null for parseable JSON with malformed renderer-consumed fields", async () => {
    const storage = new MemoryVaultStorage()
    const malformed = [
      makeSession({ id: "wrong-file-id" }),
      { ...makeSession({ id: "bad-title" }), title: null },
      { ...makeSession({ id: "bad-date" }), updatedAt: "not-a-date" },
      { ...makeSession({ id: "bad-role" }), messages: [{ role: "tool", content: "x" }] },
      { ...makeSession({ id: "bad-content" }), messages: [{ role: "user", content: null }] },
      { ...makeSession({ id: "bad-citations" }), messages: [{ role: "assistant", content: "x", citedPageIds: [7] }] },
    ]
    const ids = ["id-mismatch", "bad-title", "bad-date", "bad-role", "bad-content", "bad-citations"]

    for (let i = 0; i < ids.length; i += 1) {
      await storage.write(`${CHATS_DIR}/${ids[i]}.json`, JSON.stringify(malformed[i]))
      expect(await loadSession(storage, ids[i])).toBeNull()
    }
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

  it("skips parseable sessions whose timestamps or messages would crash consumers", async () => {
    const storage = new MemoryVaultStorage()
    await saveSession(storage, makeSession({ id: "healthy" }))
    await storage.write(
      `${CHATS_DIR}/bad-date.json`,
      JSON.stringify({ ...makeSession({ id: "bad-date" }), updatedAt: null }),
    )
    await storage.write(
      `${CHATS_DIR}/bad-message.json`,
      JSON.stringify({ ...makeSession({ id: "bad-message" }), messages: [{ role: "user", content: null }] }),
    )

    await expect(listSessions(storage)).resolves.toEqual([makeSession({ id: "healthy" })])
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
