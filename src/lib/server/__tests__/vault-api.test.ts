import { describe, it, expect, beforeEach } from "vitest"
import type { VaultStorage } from "../../vault/storage"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { RemoteVaultStorage } from "../../vault/remote-storage"
import { setServerVaultForTests } from "../vault"
import { readRecentEvents } from "../../events/log"
import * as fileRoute from "../../../app/api/vault/file/route"
import * as listRoute from "../../../app/api/vault/list/route"
import * as changesetRoute from "../../../app/api/vault/changeset/route"

class ThrowingReadStorage implements VaultStorage {
  async read(): Promise<string | null> {
    throw new Error("simulated read failure")
  }
  async write(): Promise<void> {
    throw new Error("simulated write failure")
  }
  async readBinary(): Promise<Uint8Array | null> {
    throw new Error("simulated readBinary failure")
  }
  async writeBinary(): Promise<void> {
    throw new Error("simulated writeBinary failure")
  }
  async delete(): Promise<void> {
    throw new Error("simulated delete failure")
  }
  async list(): Promise<string[]> {
    throw new Error("simulated list failure")
  }
}

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

  describe("settings.json is unreachable via the generic vault file API (M11 Task 10 carry-forward)", () => {
    const SETTINGS_URL = "http://x/api/vault/file?path=" + encodeURIComponent(".scispark/settings.json")

    it("GET .scispark/settings.json → 403", async () => {
      // Even when the file genuinely exists in storage, the route must
      // reject before ever touching storage.
      await storage.write(".scispark/settings.json", JSON.stringify({ keys: { anthropic: "sk-secret" } }))
      const res = await fileRoute.GET(new Request(SETTINGS_URL))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe("settings are managed via /api/settings")
    })

    it("PUT .scispark/settings.json → 403 (and does not write through)", async () => {
      const res = await fileRoute.PUT(
        new Request(SETTINGS_URL, {
          method: "PUT",
          headers: { "x-vault-text": "1" },
          body: JSON.stringify({ keys: { anthropic: "sk-injected" } }),
        }),
      )
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe("settings are managed via /api/settings")
      expect(await storage.read(".scispark/settings.json")).toBeNull()
    })

    it("DELETE .scispark/settings.json → 403 (and does not delete through)", async () => {
      await storage.write(".scispark/settings.json", JSON.stringify({ keys: { anthropic: "sk-secret" } }))
      const res = await fileRoute.DELETE(new Request(SETTINGS_URL, { method: "DELETE" }))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe("settings are managed via /api/settings")
      expect(await storage.read(".scispark/settings.json")).not.toBeNull()
    })

    // The guard used to compare the raw query-string path against the literal
    // ".scispark/settings.json" — but NodeFsVaultStorage resolves paths with
    // `path.resolve()`, which collapses "." segments and repeated slashes.
    // Every one of these variants resolves to the SAME on-disk file as the
    // canonical path, so they must all be blocked too (M11 Task 10 review
    // finding: path-normalization bypass).
    const PATH_VARIANTS = [
      ".scispark/settings.json",
      "./.scispark/settings.json",
      ".//.scispark/settings.json",
      ".scispark//settings.json",
      ".scispark/./settings.json",
      // Trailing-slash variants (M11 Task 10 re-review finding): `resolve()`
      // strips a trailing slash so these open the exact same real file, but
      // the old `posix.normalize()` guard KEPT the trailing slash and so
      // compared unequal — a live-reproduced bypass.
      ".scispark/settings.json/",
      ".scispark/settings.json//",
      "./.scispark/settings.json/",
      ".scispark/./settings.json/",
      // ".." traversal that nets out to the same file.
      "x/../.scispark/settings.json",
      // Case variants (live-reproduced bypass on case-insensitive
      // filesystems — macOS APFS / Windows NTFS, both local-runtime
      // targets): these resolve to the SAME on-disk file there even though
      // they differ from the canonical path as strings.
      ".scispark/SETTINGS.json",
      ".SciSpark/settings.json",
    ]

    describe.each(PATH_VARIANTS)("path-normalization variant %j", (variant) => {
      const url = "http://x/api/vault/file?path=" + encodeURIComponent(variant)

      it("GET → 403", async () => {
        await storage.write(".scispark/settings.json", JSON.stringify({ keys: { anthropic: "sk-secret" } }))
        const res = await fileRoute.GET(new Request(url))
        expect(res.status).toBe(403)
        expect((await res.json()).error).toBe("settings are managed via /api/settings")
      })

      it("PUT → 403 (and does not write through)", async () => {
        const res = await fileRoute.PUT(
          new Request(url, {
            method: "PUT",
            headers: { "x-vault-text": "1" },
            body: JSON.stringify({ keys: { anthropic: "sk-injected" } }),
          }),
        )
        expect(res.status).toBe(403)
        expect((await res.json()).error).toBe("settings are managed via /api/settings")
        expect(await storage.read(".scispark/settings.json")).toBeNull()
      })

      it("DELETE → 403 (and does not delete through)", async () => {
        await storage.write(".scispark/settings.json", JSON.stringify({ keys: { anthropic: "sk-secret" } }))
        const res = await fileRoute.DELETE(new Request(url, { method: "DELETE" }))
        expect(res.status).toBe(403)
        expect((await res.json()).error).toBe("settings are managed via /api/settings")
        expect(await storage.read(".scispark/settings.json")).not.toBeNull()
      })
    })

    it("RemoteVaultStorage read of .scispark/settings.json throws", async () => {
      await storage.write(".scispark/settings.json", JSON.stringify({ keys: { anthropic: "sk-secret" } }))
      const remote = new RemoteVaultStorage(
        (async (input, init) => {
          const req = new Request(input as string, init)
          return fileRoute.GET(req)
        }) as typeof fetch,
        "http://x",
      )
      await expect(remote.read(".scispark/settings.json")).rejects.toThrow(
        /settings are managed via \/api\/settings/,
      )
    })

    it("a neighboring .scispark file is still readable through the vault file API", async () => {
      await storage.write(".scispark/usage/x.jsonl", '{"day":"2026-07-14"}\n')
      const res = await fileRoute.GET(
        new Request("http://x/api/vault/file?path=" + encodeURIComponent(".scispark/usage/x.jsonl")),
      )
      expect(res.status).toBe(200)
      expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('{"day":"2026-07-14"}\n')
    })

    it("DELETE of non-protected files still works (a neighboring .scispark file and a wiki file)", async () => {
      await storage.write(".scispark/usage/x.jsonl", '{"day":"2026-07-14"}\n')
      await storage.write("wiki/a.md", "hello")

      const usageRes = await fileRoute.DELETE(
        new Request("http://x/api/vault/file?path=" + encodeURIComponent(".scispark/usage/x.jsonl"), {
          method: "DELETE",
        }),
      )
      expect(usageRes.status).toBe(204)
      expect(await storage.read(".scispark/usage/x.jsonl")).toBeNull()

      const wikiRes = await fileRoute.DELETE(
        new Request("http://x/api/vault/file?path=" + encodeURIComponent("wiki/a.md"), { method: "DELETE" }),
      )
      expect(wikiRes.status).toBe(204)
      expect(await storage.read("wiki/a.md")).toBeNull()
    })
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

  it("POST /api/vault/changeset: reusing a changeset id (record collision, a ChangesetInvalidError) → 400", async () => {
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
    // content-conflict check — ChangesetInvalidError always maps to 400.
    const dup = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(dup.status).toBe(400)
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

  it("POST /api/vault/changeset revert emits a changeset_revert event with skill resolved from the request body", async () => {
    const cs = {
      id: "cs-revert-skill-in-body",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/rev-2.md", before: null, after: "content" }],
    }
    await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "revert", changeset: cs }),
    }))

    const events = await readRecentEvents(storage)
    const revertEvent = events.find((e) => e.type === "changeset_revert")
    expect(revertEvent).toEqual(
      expect.objectContaining({
        type: "changeset_revert",
        changesetId: "cs-revert-skill-in-body",
        skill: "test-skill",
      }),
    )
  })

  it("POST /api/vault/changeset revert emits a changeset_revert event with skill resolved from the audit record when the posted body omits it", async () => {
    const cs = {
      id: "cs-revert-skill-from-record",
      skill: "spark-deep",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/rev-3.md", before: null, after: "content" }],
    }
    await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))

    // A posted revert body that carries only id + changes (no `skill`) — the
    // route must fall back to loadChangeset's persisted audit record.
    const { skill: _skill, ...changesetWithoutSkill } = cs
    void _skill
    await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "revert", changeset: changesetWithoutSkill }),
    }))

    const events = await readRecentEvents(storage)
    const revertEvent = events.find(
      (e) => e.type === "changeset_revert" && e.changesetId === "cs-revert-skill-from-record",
    )
    expect(revertEvent).toEqual(
      expect.objectContaining({
        type: "changeset_revert",
        changesetId: "cs-revert-skill-from-record",
        skill: "spark-deep",
      }),
    )
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

  it("POST /api/vault/changeset with duplicate paths (ChangesetInvalidError) → 400", async () => {
    const cs = {
      id: "cs-dup-paths",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [
        { path: "wiki/dup.md", before: null, after: "v1" },
        { path: "wiki/dup.md", before: "v1", after: "v2" },
      ],
    }
    const res = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/duplicate/i)
  })

  it("POST /api/vault/changeset targeting protected path index.md (ChangesetInvalidError) → 400", async () => {
    const cs = {
      id: "cs-protected",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "index.md", before: null, after: "hacked" }],
    }
    const res = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/protected/i)
  })

  it("POST /api/vault/changeset targeting protected path log.md (ChangesetInvalidError) → 400", async () => {
    const cs = {
      id: "cs-protected-log",
      skill: "test-skill",
      model: "test-model",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "log.md", before: null, after: "hacked" }],
    }
    const res = await changesetRoute.POST(new Request("http://x/api/vault/changeset", {
      method: "POST", body: JSON.stringify({ action: "apply", changeset: cs }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/protected/i)
  })

  it("GET /api/vault/file: storage error → 500 with JSON {error}", async () => {
    setServerVaultForTests(new ThrowingReadStorage())
    const res = await fileRoute.GET(new Request("http://x/api/vault/file?path=test.md"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })

  it("GET /api/vault/list: storage error → 500 with JSON {error}", async () => {
    setServerVaultForTests(new ThrowingReadStorage())
    const res = await listRoute.GET(new Request("http://x/api/vault/list?prefix=wiki/"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })

  it("PUT /api/vault/file: storage error → 500 with JSON {error}", async () => {
    setServerVaultForTests(new ThrowingReadStorage())
    const res = await fileRoute.PUT(new Request("http://x/api/vault/file?path=test.md", {
      method: "PUT",
      headers: { "x-vault-text": "1" },
      body: "content",
    }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })

  it("DELETE /api/vault/file: storage error → 500 with JSON {error}", async () => {
    setServerVaultForTests(new ThrowingReadStorage())
    const res = await fileRoute.DELETE(new Request("http://x/api/vault/file?path=test.md", {
      method: "DELETE",
    }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toHaveProperty("error")
    expect(body.error).toMatch(/failure/)
  })
})
