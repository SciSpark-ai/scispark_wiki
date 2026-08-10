import { describe, it, expect, vi } from "vitest"

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

  it("clears memoized promise on rejection and retries on next call (transient failure recovery)", async () => {
    // Fresh module with fresh imports so we can mock scaffold.openVault independently.
    vi.resetModules()

    // Mock openVault in scaffold.ts to fail first, succeed second.
    let callCount = 0
    vi.doMock("../scaffold", () => ({
      openVault: vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          throw new Error("transient OPFS failure")
        }
        // On second call, succeed (no-op since schema.md will already exist from retry).
      }),
    }))

    const { getOpenVault } = await import("../get-vault")

    // First call should reject.
    await expect(getOpenVault()).rejects.toThrow("transient OPFS failure")

    // Second call should succeed and retry (openVault called again), not return cached rejection.
    const storage = await getOpenVault()
    expect(storage).toBeDefined()
    expect(callCount).toBe(2) // openVault was called twice: once (failed), once (succeeded).
  })
})
