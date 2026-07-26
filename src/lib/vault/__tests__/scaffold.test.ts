import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { createVault, VaultExistsError, openVault } from "../scaffold"

describe("createVault", () => {
  it("writes the four reserved files with the schema table", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "Track TRD neuromodulation research.", today: "2026-07-11" })
    const schema = (await s.read("schema.md")) as string
    expect(schema).toContain("## Page Types")
    for (const row of [
      "| paper | wiki/papers |",
      "| idea | wiki/ideas |",
      "| query | wiki/queries |",
      "| project | wiki/projects |",
    ]) {
      expect(schema).toContain(row)
    }
    expect(await s.read("purpose.md")).toContain("Track TRD neuromodulation research.")
    expect(await s.read("index.md")).toContain("# Index")
    expect(await s.read("log.md")).toContain("## [2026-07-11] init | vault created")
  })

  it("refuses to scaffold over an existing vault", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "p", today: "2026-07-11" })
    await expect(createVault(s, { purpose: "p", today: "2026-07-11" })).rejects.toThrow(VaultExistsError)
  })
})

describe("openVault", () => {
  it("creates a vault when schema.md is missing", async () => {
    const s = new MemoryVaultStorage()
    await openVault(s, { now: () => new Date("2026-07-11T00:00:00Z") })
    expect(await s.read("schema.md")).not.toBeNull()
    expect(await s.read("log.md")).toContain("[2026-07-11] init | vault created")
  })

  it("defaults purpose to 'Personal research knowledge base.'", async () => {
    const s = new MemoryVaultStorage()
    await openVault(s, { now: () => new Date("2026-07-11T00:00:00Z") })
    expect(await s.read("purpose.md")).toContain("Personal research knowledge base.")
  })

  it("is idempotent: no-ops when schema.md already exists", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "Existing purpose.", today: "2026-07-11" })
    await openVault(s, { purpose: "Should be ignored.", now: () => new Date("2026-07-12T00:00:00Z") })
    const log = (await s.read("log.md")) as string
    expect(log.match(/init \| vault created/g)?.length).toBe(1)
    expect(await s.read("purpose.md")).toContain("Existing purpose.")
  })

  it("serializes 10 concurrent calls on one fresh storage into exactly one vault creation, with no rejections", async () => {
    const s = new MemoryVaultStorage()
    const calls = Array.from({ length: 10 }, () =>
      openVault(s, { now: () => new Date("2026-07-11T00:00:00Z") }),
    )
    const results = await Promise.allSettled(calls)
    expect(results.every((r) => r.status === "fulfilled")).toBe(true)
    const log = (await s.read("log.md")) as string
    expect(log.match(/init \| vault created/g)?.length).toBe(1)
  })
})
