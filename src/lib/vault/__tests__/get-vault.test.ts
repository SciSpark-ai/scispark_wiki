import { describe, it, expect } from "vitest"

describe("getOpenVault", () => {
  it("resolves storage and bootstraps the vault exactly once, memoizing the promise", async () => {
    // Fresh module instance per test so vaultPromise/openVaultPromise module
    // state doesn't leak across tests (vitest isolates modules per test file,
    // but re-import defensively via resetModules-style dynamic import).
    const { getOpenVault } = await import("../get-vault")

    const [a, b] = await Promise.all([getOpenVault(), getOpenVault()])
    expect(a).toBe(b) // same storage instance — memoized

    expect(await a.read("schema.md")).not.toBeNull()
    const log = (await a.read("log.md")) as string
    expect(log.match(/init \| vault created/g)?.length).toBe(1)

    // Calling again returns the same memoized promise/result without re-running openVault.
    const c = await getOpenVault()
    expect(c).toBe(a)
    const logAgain = (await c.read("log.md")) as string
    expect(logAgain.match(/init \| vault created/g)?.length).toBe(1)
  })
})
