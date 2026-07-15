import { describe, it, expect } from "vitest"
import { MemoryVaultStorage } from "../memory-storage"
import { exportVaultZip, importVaultZip } from "../export"

describe("vault export/import round-trip", () => {
  it("round-trips wiki pages + .scispark internals + a binary asset byte-identically (minus excluded paths)", async () => {
    const src = new MemoryVaultStorage()
    await src.write("wiki/concepts/a.md", "# A\n\nbody with unicode 日本語")
    await src.write("index.md", "- [[a]]")
    await src.write(".scispark/events/2026-07-14.jsonl", '{"type":"search"}\n')
    await src.writeBinary("sources/p.pdf", new Uint8Array([0, 1, 2, 255, 254]))
    // A key-bearing settings file that MUST be excluded from export (export.ts's SENSITIVE_PATHS).
    await src.write(".scispark/settings.json", '{"llm":{"keys":{"openai":"sk-secret"}}}')

    const zip = await exportVaultZip(src)
    // Secret must not appear anywhere in the zip bytes.
    expect(new TextDecoder().decode(zip).includes("sk-secret")).toBe(false)

    const dst = new MemoryVaultStorage()
    const { files } = await importVaultZip(dst, zip)

    // 4 entries expected in the zip: wiki page, index, events log, binary asset.
    // settings.json is excluded from export, so it never becomes a zip entry to import.
    expect(files).toBe(4)

    expect(await dst.read("wiki/concepts/a.md")).toBe("# A\n\nbody with unicode 日本語")
    expect(await dst.read("index.md")).toBe("- [[a]]")
    expect(await dst.read(".scispark/events/2026-07-14.jsonl")).toBe('{"type":"search"}\n')
    expect(Array.from((await dst.readBinary("sources/p.pdf")) as Uint8Array)).toEqual([
      0, 1, 2, 255, 254,
    ])
    // Excluded settings file did not round-trip.
    expect(await dst.read(".scispark/settings.json")).toBeNull()
  })
})
