import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { createVault, VaultExistsError } from "../scaffold"

describe("createVault", () => {
  it("writes the four reserved files with the schema table", async () => {
    const s = new MemoryVaultStorage()
    await createVault(s, { purpose: "Track TRD neuromodulation research.", today: "2026-07-11" })
    const schema = (await s.read("schema.md")) as string
    expect(schema).toContain("## Page Types")
    for (const row of ["| paper | wiki/papers |", "| idea | wiki/ideas |", "| project | wiki/projects |"]) {
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
