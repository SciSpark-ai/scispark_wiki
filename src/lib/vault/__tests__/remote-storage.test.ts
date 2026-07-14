import { describe, beforeEach } from "vitest"
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
