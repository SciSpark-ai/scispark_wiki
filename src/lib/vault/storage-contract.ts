import { it, expect } from "vitest"
import type { VaultStorage } from "./storage"

export function storageContractTests(name: string, make: () => Promise<VaultStorage>) {
  it(`${name}: read of missing path returns null`, async () => {
    const s = await make()
    expect(await s.read("wiki/none.md")).toBeNull()
  })
  it(`${name}: write then read round-trips`, async () => {
    const s = await make()
    await s.write("wiki/concepts/a.md", "hello")
    expect(await s.read("wiki/concepts/a.md")).toBe("hello")
  })
  it(`${name}: overwrite replaces content`, async () => {
    const s = await make()
    await s.write("a.md", "one")
    await s.write("a.md", "two")
    expect(await s.read("a.md")).toBe("two")
  })
  it(`${name}: list returns sorted matching paths`, async () => {
    const s = await make()
    await s.write("wiki/concepts/b.md", "x")
    await s.write("wiki/concepts/a.md", "x")
    await s.write("wiki/papers/p.md", "x")
    expect(await s.list("wiki/concepts/")).toEqual(["wiki/concepts/a.md", "wiki/concepts/b.md"])
    expect((await s.list()).length).toBe(3)
  })
  it(`${name}: delete removes; deleting missing is a no-op`, async () => {
    const s = await make()
    await s.write("a.md", "x")
    await s.delete("a.md")
    expect(await s.read("a.md")).toBeNull()
    await s.delete("a.md") // must not throw
  })
}
