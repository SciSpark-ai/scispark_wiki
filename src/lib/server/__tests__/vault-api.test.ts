import { describe, it, expect, beforeEach } from "vitest"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { setServerVaultForTests } from "../vault"
import * as fileRoute from "../../../app/api/vault/file/route"
import * as listRoute from "../../../app/api/vault/list/route"
import * as changesetRoute from "../../../app/api/vault/changeset/route"

describe("vault API", () => {
  let storage: MemoryVaultStorage
  beforeEach(() => {
    storage = new MemoryVaultStorage()
    setServerVaultForTests(storage)
  })

  it("PUT text → GET round-trips; 404 for missing; DELETE removes", async () => {
    const put = await fileRoute.PUT(new Request("http://x/api/vault/file?path=wiki/a.md", {
      method: "PUT", headers: { "x-vault-text": "1" }, body: "hello",
    }))
    expect(put.status).toBe(204)
    const got = await fileRoute.GET(new Request("http://x/api/vault/file?path=wiki/a.md"))
    expect(got.status).toBe(200)
    expect(new TextDecoder().decode(await got.arrayBuffer())).toBe("hello")
    expect((await fileRoute.GET(new Request("http://x/api/vault/file?path=nope.md"))).status).toBe(404)
    expect((await fileRoute.DELETE(new Request("http://x/api/vault/file?path=wiki/a.md", { method: "DELETE" }))).status).toBe(204)
    expect(await storage.read("wiki/a.md")).toBeNull()
  })

  it("PUT binary round-trips losslessly without the text header", async () => {
    const bytes = new Uint8Array([0, 159, 146, 150, 255])
    const put = await fileRoute.PUT(new Request("http://x/api/vault/file?path=assets/a.bin", {
      method: "PUT", body: bytes,
    }))
    expect(put.status).toBe(204)
    const got = await fileRoute.GET(new Request("http://x/api/vault/file?path=assets/a.bin"))
    expect(got.status).toBe(200)
    expect(got.headers.get("content-type")).toBe("application/octet-stream")
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
  })

  it("GET /api/vault/list filters by prefix", async () => {
    await storage.write("wiki/a.md", "x"); await storage.write("notes/n.md", "x")
    const res = await listRoute.GET(new Request("http://x/api/vault/list?prefix=wiki/"))
    expect(await res.json()).toEqual({ paths: ["wiki/a.md"] })
  })

  it("missing path param → 400", async () => {
    expect((await fileRoute.GET(new Request("http://x/api/vault/file"))).status).toBe(400)
    expect((await fileRoute.PUT(new Request("http://x/api/vault/file", { method: "PUT", body: "x" }))).status).toBe(400)
    expect((await fileRoute.DELETE(new Request("http://x/api/vault/file", { method: "DELETE" }))).status).toBe(400)
  })

  it("POST /api/vault/changeset applies atomically server-side and 409s on conflict", async () => {
    const cs = {
      id: "cs-1",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/new.md", before: null, after: "content" }],
    }
    const ok = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true })
    expect(await storage.read("wiki/new.md")).toBe("content")

    // A second changeset targeting the same path with a stale `before` now
    // genuinely conflicts (current content is "content", not null) — this is
    // the real ChangesetConflictError path (applyChangeset's conflict check),
    // distinct from the id-collision ChangesetInvalidError that reusing the
    // same changeset id would hit first.
    const cs2 = {
      id: "cs-2",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:01Z",
      changes: [{ path: "wiki/new.md", before: null, after: "other" }],
    }
    const dup = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs2 }),
    }))
    expect(dup.status).toBe(409)
    const dupBody = await dup.json()
    expect(dupBody.error).toBeTruthy()
    expect(await storage.read("wiki/new.md")).toBe("content")
  })

  it("POST /api/vault/changeset: reusing a changeset id (record collision, not a content conflict) → 500", async () => {
    const cs = {
      id: "cs-collide",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/collide.md", before: null, after: "content" }],
    }
    const ok = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(ok.status).toBe(200)
    // Re-applying the exact same changeset (same id) hits applyChangeset's
    // id-collision guard (ChangesetInvalidError), which runs before the
    // content-conflict check — this is NOT a ChangesetConflictError, so the
    // route maps it to 500 per the brief's "other errors → 500" rule.
    const dup = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(dup.status).toBe(500)
    expect((await dup.json()).error).toMatch(/collision/i)
  })

  it("POST /api/vault/changeset reverts", async () => {
    const cs = {
      id: "cs-2",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/rev.md", before: null, after: "content" }],
    }
    await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    const revert = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "revert", changeset: cs }),
    }))
    expect(revert.status).toBe(200)
    expect(await storage.read("wiki/rev.md")).toBeNull()
  })

  it("POST /api/vault/changeset malformed body → 400", async () => {
    const badJson = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: "not json",
    }))
    expect(badJson.status).toBe(400)

    const badAction = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST",
      body: JSON.stringify({ action: "nope", changeset: { id: "x", skill: "s", model: "m", timestamp: "t", changes: [] } }),
    }))
    expect(badAction.status).toBe(400)

    const missingChangeset = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST",
      body: JSON.stringify({ action: "apply" }),
    }))
    expect(missingChangeset.status).toBe(400)
  })
})
