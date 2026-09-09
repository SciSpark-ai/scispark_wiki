import { mkdir, readFile, writeFile, rm, readdir, rename } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import type { VaultStorage } from "./storage"
import { randomUUID } from "node:crypto"

export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH" }
}

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
  get coordinationKey() { return `node-fs:${this.root}` }

  /** Lamport bakery lock over atomic contender files. Each contender removes
   * only its OWN file; recovery ignores dead PIDs instead of unlinking another
   * owner's lock (which can race with a new owner). Local filesystems only.
   * Corrupt records and live reused PIDs fail closed, never grant two owners. */
  async exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(name)) throw new Error("Invalid lock name")
    const prefix = `.scispark/locks/${name}/`
    const id = `${process.pid}-${randomUUID()}`
    const own = `${prefix}${id}.json`
    type Ticket = { pid: number; choosing: boolean; ticket: number }
    const read = async (path: string): Promise<Ticket | null> => {
      const raw = await this.read(path)
      if (raw === null) return null
      const t = JSON.parse(raw) as Ticket
      if (!Number.isSafeInteger(t.pid) || t.pid < 1 || typeof t.choosing !== "boolean" || !Number.isSafeInteger(t.ticket) || t.ticket < 0) throw new Error("Corrupt ownership record; inspect the vault lock")
      return processIsAlive(t.pid) ? t : null
    }
    const paths = async () => {
      try { return (await readdir(this.abs(prefix))).filter((p) => p.endsWith(".json")).map((p) => prefix + p) }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e }
    }
    await this.write(own, JSON.stringify({ pid: process.pid, choosing: true, ticket: 0 }))
    try {
      let ticket = 1
      for (const path of await paths()) ticket = Math.max(ticket, ((await read(path))?.ticket ?? 0) + 1)
      await this.write(own, JSON.stringify({ pid: process.pid, choosing: false, ticket }))
      for (const path of await paths()) {
        if (path === own) continue
        const deadline = Date.now() + 300_000
        while (true) {
          const other = await read(path)
          if (!other || (!other.choosing && (other.ticket > ticket || (other.ticket === ticket && path > own)))) break
          if (Date.now() > deadline) throw new Error("Another vault operation is still running. Try again shortly.")
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      }
      return await work()
    } finally { await this.delete(own) }
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
    // tmp+rename so a crash mid-write never leaves a truncated file (matches the OPFS swap-file atomicity we replaced)
    const tmpPath = `${full}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await writeFile(tmpPath, content, "utf8")
      await rename(tmpPath, full)
    } catch (e) {
      await rm(tmpPath, { force: true })
      throw e
    }
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
    // tmp+rename so a crash mid-write never leaves a truncated file (matches the OPFS swap-file atomicity we replaced)
    const tmpPath = `${full}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    try {
      await writeFile(tmpPath, data)
      await rename(tmpPath, full)
    } catch (e) {
      await rm(tmpPath, { force: true })
      throw e
    }
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
