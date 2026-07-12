import type { VaultStorage } from "./storage"

export class OpfsVaultStorage implements VaultStorage {
  private constructor(private root: FileSystemDirectoryHandle) {}

  static async create(rootDirName = "scispark-vault"): Promise<OpfsVaultStorage> {
    const opfsRoot = await navigator.storage.getDirectory()
    const root = await opfsRoot.getDirectoryHandle(rootDirName, { create: true })
    return new OpfsVaultStorage(root)
  }

  private async dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
    const parts = path.split("/")
    const name = parts.pop() as string
    let dir = this.root
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create })
      } catch {
        return null
      }
    }
    return { dir, name }
  }

  async read(path: string): Promise<string | null> {
    const loc = await this.dirFor(path, false)
    if (!loc) return null
    try {
      const fh = await loc.dir.getFileHandle(loc.name)
      return await (await fh.getFile()).text()
    } catch {
      return null
    }
  }

  async write(path: string, content: string): Promise<void> {
    const loc = await this.dirFor(path, true)
    if (!loc) throw new Error(`cannot create directories for ${path}`)
    const fh = await loc.dir.getFileHandle(loc.name, { create: true })
    const w = await fh.createWritable()
    await w.write(content)
    await w.close()
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    const loc = await this.dirFor(path, false)
    if (!loc) return null
    try {
      const fh = await loc.dir.getFileHandle(loc.name)
      const buf = await (await fh.getFile()).arrayBuffer()
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const loc = await this.dirFor(path, true)
    if (!loc) throw new Error(`cannot create directories for ${path}`)
    const fh = await loc.dir.getFileHandle(loc.name, { create: true })
    const w = await fh.createWritable()
    await w.write(data as Uint8Array<ArrayBuffer>)
    await w.close()
  }

  async delete(path: string): Promise<void> {
    const loc = await this.dirFor(path, false)
    if (!loc) return
    try {
      await loc.dir.removeEntry(loc.name)
    } catch {
      /* missing = no-op */
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, base: string) => {
      for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        const p = base ? `${base}/${name}` : name
        if (handle.kind === "file") {
          if (p.startsWith(prefix)) out.push(p)
        } else {
          await walk(handle as FileSystemDirectoryHandle, p)
        }
      }
    }
    await walk(this.root, "")
    return out.sort()
  }
}
