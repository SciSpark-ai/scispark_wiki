import { describe, it, expect, beforeEach } from "vitest"
import type { VaultStorage } from "../../vault/storage"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { RemoteVaultStorage } from "../../vault/remote-storage"
import { setServerVaultForTests } from "../vault"
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

class ThrowDerivedStorage implements VaultStorage {
  private inner = new MemoryVaultStorage()

  read(path: string): Promise<string | null> {
    return this.inner.read(path)
  }
  async write(path: string, content: string): Promise<void> {
    if (path === "index.md" || path === "log.md") {
      throw new Error(`simulated derived failure: ${path}`)
    }
    await this.inner.write(path, content)
  }
  readBinary(path: string): Promise<Uint8Array | null> {
    return this.inner.readBinary(path)
  }
  writeBinary(path: string, data: Uint8Array): Promise<void> {
    return this.inner.writeBinary(path, data)
  }
  delete(path: string): Promise<void> {
    return this.inner.delete(path)
  }
  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
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

  it.each(["../outside.md", "/absolute.md", "wiki//bad.md", "wiki/./bad.md", "C:\\outside.md"])(
    "rejects unsafe generic vault path %j before storage access",
    async (path) => {
      const url = "http://x/api/vault/file?path=" + encodeURIComponent(path)
      expect((await fileRoute.GET(new Request(url))).status).toBe(400)
      expect((await fileRoute.PUT(new Request(url, { method: "PUT", body: "x" }))).status).toBe(400)
      expect((await fileRoute.DELETE(new Request(url, { method: "DELETE" }))).status).toBe(400)
    },
  )

  it("prevents generic clients from forging or deleting persisted changeset records", async () => {
    const path = ".scispark/changesets/forged.json"
    const url = "http://x/api/vault/file?path=" + encodeURIComponent(path)

    const put = await fileRoute.PUT(new Request(url, { method: "PUT", body: "{}" }))
    expect(put.status).toBe(403)
    expect((await put.json()).error).toBe("changeset audit records are server-managed")
    expect(await storage.read(path)).toBeNull()

    await storage.write(path, "persisted")
    expect((await fileRoute.GET(new Request(url))).status).toBe(200)
    expect((await fileRoute.DELETE(new Request(url, { method: "DELETE" }))).status).toBe(403)
    expect(await storage.read(path)).toBe("persisted")
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
    expect(await ok.json()).toEqual({
      ok: true,
      changesetId: "cs-1",
      warnings: [],
    })
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

  it("POST /api/vault/changeset reports post-commit derived failures as warnings", async () => {
    const warningStorage = new ThrowDerivedStorage()
    setServerVaultForTests(warningStorage)
    const response = await changesetRoute.POST(
      new Request("http://x/api/vault/changeset", {
        method: "POST",
        body: JSON.stringify({
          action: "apply",
          changeset: {
            id: "cs-api-warning",
            skill: "project-create",
            model: "none",
            timestamp: "2026-08-10T12:00:00.000Z",
            changes: [{ path: "wiki/projects/warning.md", before: null, after: "project" }],
          },
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      changesetId: "cs-api-warning",
      warnings: [
        expect.objectContaining({ code: "index-refresh-failed" }),
        expect.objectContaining({ code: "log-append-failed" }),
      ],
    })
    expect(await warningStorage.read("wiki/projects/warning.md")).toBe("project")
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

  it("POST /api/vault/changeset reverts only the persisted record named by changesetId", async () => {
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
      method: "POST", body: JSON.stringify({ action: "revert", changesetId: cs.id }),
    }))
    expect(revert.status).toBe(200)
    expect(await storage.read("wiki/rev.md")).toBeNull()
  })

  it("POST /api/vault/changeset rejects a client-forged revert payload", async () => {
    await storage.write(".scispark/settings.json", "secret-settings")
    const forged = {
      id: "cs-forged",
      skill: "attacker",
      model: "none",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: ".scispark/settings.json", before: "forged-settings", after: "secret-settings" }],
    }

    const response = await changesetRoute.POST(
      new Request("http://x/api/vault/changeset", {
        method: "POST",
        body: JSON.stringify({ action: "revert", changeset: forged }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await storage.read(".scispark/settings.json")).toBe("secret-settings")
  })

  it("POST /api/vault/changeset rejects client file contents even when a changesetId is present", async () => {
    const changeset = {
      id: "cs-no-forged-content",
      skill: "test-skill",
      model: "none",
      timestamp: "2026-07-14T00:00:00Z",
      changes: [{ path: "wiki/safe.md", before: null, after: "safe" }],
    }
    await changesetRoute.POST(
      new Request("http://x/api/vault/changeset", {
        method: "POST",
        body: JSON.stringify({ action: "apply", changeset }),
      }),
    )

    const response = await changesetRoute.POST(
      new Request("http://x/api/vault/changeset", {
        method: "POST",
        body: JSON.stringify({
          action: "revert",
          changesetId: changeset.id,
          changeset: {
            ...changeset,
            changes: [{ path: ".scispark/settings.json", before: "bad", after: "secret" }],
          },
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(await storage.read("wiki/safe.md")).toBe("safe")
  })

  it("POST /api/vault/changeset has no force-revert request shape", async () => {
    const response = await changesetRoute.POST(
      new Request("http://x/api/vault/changeset", {
        method: "POST",
        body: JSON.stringify({ action: "revert", changesetId: "cs-any", force: true }),
      }),
    )

    expect(response.status).toBe(400)
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
