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

  // Regression: the browser's native `fetch` throws "Illegal invocation" when
  // called with a receiver other than the global object. Requests are issued
  // as `this.fetchFn(...)` (a method call, receiver = the storage instance),
  // so the underlying fetch must be invoked such that ITS receiver is never
  // the instance — otherwise every browser vault read/write bricks. A
  // receiver-agnostic mock (like routeFetch) can't catch this, so assert the
  // receiver directly with a plain `function` that records its `this`.
  it("never invokes the underlying fetch with the storage instance as receiver", async () => {
    const holder: { storage?: RemoteVaultStorage } = {}
    let calledAsMethodOfInstance = false
    const recordingFetch = function (this: unknown) {
      if (this === holder.storage) calledAsMethodOfInstance = true
      return Promise.resolve(new Response(new Uint8Array(), { status: 200 }))
    } as unknown as typeof fetch

    holder.storage = new RemoteVaultStorage(recordingFetch, "http://local")
    await holder.storage.readBinary("foo.md")

    // Broken code stored the bare global and did `this.fetchFn(...)`, making the
    // native fetch's receiver the instance → "Illegal invocation" in a browser.
    expect(calledAsMethodOfInstance).toBe(false)
  })
})

// Regression for the *default* fetchFn specifically: getVault() constructs
// `new RemoteVaultStorage()` with no args, so the no-arg default is the real
// production path. The test above injects a fetchFn and so never exercises the
// `= fetch` default — a future change back to storing the bare global as the
// default would still pass it, but brick the app. Reproduce the browser's
// receiver check against a strict global fetch through the no-arg constructor.
describe("RemoteVaultStorage default fetchFn receiver", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("calls the global fetch without rebinding `this` to the instance", async () => {
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
