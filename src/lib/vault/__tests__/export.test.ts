import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { exportVaultZip, importVaultZip } from "../export"

describe("vault zip round-trip", () => {
  it("export → import reproduces every file", async () => {
    const src = new MemoryVaultStorage()
    await src.write("purpose.md", "# Purpose\np\n")
    await src.write("wiki/concepts/a.md", "---\n...")
    await src.write(".scispark/changesets/cs-1-abcd.json", "{}")

    const zip = await exportVaultZip(src)
    const dst = new MemoryVaultStorage()
    const { files } = await importVaultZip(dst, zip)

    expect(files).toBe(3)
    expect(dst.snapshot()).toEqual(src.snapshot())
  })
})
