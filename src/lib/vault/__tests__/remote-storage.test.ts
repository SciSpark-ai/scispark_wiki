import { describe, it, expect, afterEach } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { setServerVaultForTests } from "../../server/vault"
import * as fileRoute from "../../../app/api/vault/file/route"
import * as listRoute from "../../../app/api/vault/list/route"
import { storageContractTests } from "../storage-contract"
import { RemoteVaultStorage } from "../remote-storage"

// A fetch that dispatches to the real route handlers in-process.
function routeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), init)
    const { pathname } = new URL(req.url)
    if (pathname === "/api/vault/file") {
      if (req.method === "GET") return fileRoute.GET(req)
      if (req.method === "PUT") return fileRoute.PUT(req)
      if (req.method === "DELETE") return fileRoute.DELETE(req)
    }
    if (pathname === "/api/vault/list") return listRoute.GET(req)
    return new Response("not found", { status: 404 })
  }) as typeof fetch
}

describe("RemoteVaultStorage (against real route handlers)", () => {
  storageContractTests("RemoteVaultStorage", async () => {
    setServerVaultForTests(new MemoryVaultStorage())
    return new RemoteVaultStorage(routeFetch(), "http://local")
  })
})

// Regression: the default fetchFn must invoke the global fetch with the global
// receiver. Assigning the bare `fetch` to a property and calling it via
// `this.fetchFn(...)` rebinds `this` to the instance, which real browsers reject
// with "Failed to execute 'fetch' on 'Window': Illegal invocation". Reproduce
// that receiver check here so the wrapper default can't regress.
describe("RemoteVaultStorage default fetchFn receiver", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("calls the global fetch without rebinding `this` to the instance", async () => {
    // A fetch that throws Illegal-invocation-style when its receiver is not the
    // global object — the same guard native browser fetch applies.
    const strictFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    } as unknown as typeof fetch
    globalThis.fetch = strictFetch

    const storage = new RemoteVaultStorage() // default fetchFn
    await expect(storage.read("anything.md")).resolves.toBeNull()
  })
})
