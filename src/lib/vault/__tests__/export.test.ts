import { describe, it, expect } from "vitest"
import { unzipSync, zipSync, strToU8 } from "fflate"
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

  it("export excludes .scispark/settings.json (BYOK keys) but includes the rest of the vault", async () => {
    const src = new MemoryVaultStorage()
    await src.write("purpose.md", "# Purpose\np\n")
    await src.write("wiki/concepts/a.md", "---\n...")
    await src.write(
      ".scispark/settings.json",
      JSON.stringify({ llm: { keys: { anthropic: "sk-live-secret" } } }),
    )

    const zip = await exportVaultZip(src)
    const entries = unzipSync(zip)

    expect(Object.keys(entries)).not.toContain(".scispark/settings.json")
    expect(Object.keys(entries).sort()).toEqual(["purpose.md", "wiki/concepts/a.md"])
  })

  it("import skips zip entries matching .scispark/settings.json, leaving the destination's own settings untouched", async () => {
    const dst = new MemoryVaultStorage()
    const destinationSettings = JSON.stringify({ llm: { keys: { anthropic: "sk-destination-secret" } } })
    await dst.write(".scispark/settings.json", destinationSettings)

    // A zip crafted (e.g. by another user's export, or an older exporter) that
    // does contain a settings.json entry — importing it must not clobber ours.
    const foreignZip = zipSync({
      "purpose.md": strToU8("# Shared\n"),
      ".scispark/settings.json": strToU8(
        JSON.stringify({ llm: { keys: { anthropic: "sk-attacker-secret" } } }),
      ),
    })

    const { files } = await importVaultZip(dst, foreignZip)

    expect(files).toBe(1) // settings.json entry excluded from the count
    expect(await dst.read(".scispark/settings.json")).toBe(destinationSettings)
    expect(await dst.read("purpose.md")).toBe("# Shared\n")
  })
})
