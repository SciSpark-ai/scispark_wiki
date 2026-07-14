import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import type { VaultStorage } from "./storage"

/**
 * VaultStorage over a real directory on disk (M11 local-runtime pivot,
 * docs/superpowers/specs/2026-07-14-m11-local-runtime-design.md). The vault is
 * plain files the user owns; this class is the server-side storage the whole
 * runtime uses. Every path is resolved and must stay under the root.
 */
export class NodeFsVaultStorage implements VaultStorage {
  private root: string
  constructor(root: string) {
    this.root = resolve(root)
  }

  private abs(path: string): string {
    const full = resolve(this.root, path)
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`path escapes outside the vault root: ${path}`)
    }
    return full
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.abs(path), "utf8")
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
  }

  async write(path: string, content: string): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content, "utf8")
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.abs(path))
      return new Uint8Array(buf)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
      throw e
    }
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
  }

  async delete(path: string): Promise<void> {
    await rm(this.abs(path), { force: true })
  }

  async list(prefix?: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (dirAbs: string, rel: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dirAbs, { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return
        throw e
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(join(dirAbs, entry.name), childRel)
        else out.push(childRel)
      }
    }
    await walk(this.root, "")
    const filtered = prefix ? out.filter((p) => p.startsWith(prefix)) : out
    return filtered.sort()
  }
}
