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
    const paths = await src.list()
    expect(await dst.list()).toEqual(paths)
    for (const path of paths) {
      expect(await dst.read(path)).toBe(await src.read(path))
    }
  })

  it("round-trips a binary file (all 256 byte values) and a text file losslessly", async () => {
    const src = new MemoryVaultStorage()
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    await src.writeBinary("assets/blob.bin", bytes)
    await src.write("purpose.md", "# Purpose\nhello\n")

    const zip = await exportVaultZip(src)
    const dst = new MemoryVaultStorage()
    const { files } = await importVaultZip(dst, zip)

    expect(files).toBe(2)
    const roundTripped = await dst.readBinary("assets/blob.bin")
    expect(roundTripped).not.toBeNull()
    expect(Array.from(roundTripped as Uint8Array)).toEqual(Array.from(bytes))
    expect(await dst.read("purpose.md")).toBe("# Purpose\nhello\n")
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

  it("rejects every unsafe archive path before writing any entry", async () => {
    const dst = new MemoryVaultStorage()
    const crafted = zipSync({
      "wiki/safe.md": strToU8("safe"),
      "../outside.md": strToU8("unsafe"),
    })

    await expect(importVaultZip(dst, crafted)).rejects.toThrow(/unsafe vault archive path/)
    expect(await dst.list()).toEqual([])
  })

  it("skips case-variant settings paths on import", async () => {
    const dst = new MemoryVaultStorage()
    const crafted = zipSync({
      ".scispark/SETTINGS.json": strToU8("attacker settings"),
      "wiki/safe.md": strToU8("safe"),
    })

    await expect(importVaultZip(dst, crafted)).resolves.toEqual({ files: 1 })
    expect(await dst.read(".scispark/SETTINGS.json")).toBeNull()
    expect(await dst.read("wiki/safe.md")).toBe("safe")
  })
})
