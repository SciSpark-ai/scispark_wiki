import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { storageContractTests } from "../storage-contract"
import { NodeFsVaultStorage } from "../node-fs-storage"
import { resolveVaultRoot } from "../vault-path"

describe("NodeFsVaultStorage", () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "scispark-vault-")) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  describe("storage contract", () => {
    // Each contract test gets a fresh subdirectory so tests don't interfere.
    let n = 0
    storageContractTests("NodeFsVaultStorage", async () => new NodeFsVaultStorage(join(mkdtempSync(join(tmpdir(), "scispark-c-")), String(n++))))
  })

  it("rejects path traversal on every operation", async () => {
    const s = new NodeFsVaultStorage(dir)
    for (const bad of ["../outside.md", "a/../../outside.md", "/etc/passwd"]) {
      await expect(s.read(bad)).rejects.toThrow(/outside the vault|traversal/i)
      await expect(s.write(bad, "x")).rejects.toThrow(/outside the vault|traversal/i)
      await expect(s.delete(bad)).rejects.toThrow(/outside the vault|traversal/i)
    }
  })

  it("writeBinary/readBinary round-trips bytes losslessly", async () => {
    const s = new NodeFsVaultStorage(dir)
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128])
    await s.writeBinary("assets/x.bin", bytes)
    expect(Array.from((await s.readBinary("assets/x.bin"))!)).toEqual(Array.from(bytes))
  })
})

describe("resolveVaultRoot", () => {
  it("prefers SCISPARK_VAULT; falls back to ~/SciSpark/vault", () => {
    expect(resolveVaultRoot({ SCISPARK_VAULT: "/tmp/custom" } as unknown as NodeJS.ProcessEnv)).toBe("/tmp/custom")
    const def = resolveVaultRoot({} as unknown as NodeJS.ProcessEnv)
    expect(def.endsWith("/SciSpark/vault")).toBe(true)
  })
})
