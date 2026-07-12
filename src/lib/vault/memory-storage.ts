import type { VaultStorage } from "./storage"

export class MemoryVaultStorage implements VaultStorage {
  private files = new Map<string, string>()
  private binaryFiles = new Map<string, Uint8Array>()

  async read(path: string): Promise<string | null> {
    if (this.files.has(path)) return this.files.get(path) as string
    if (this.binaryFiles.has(path)) {
      // Callers know which paths are binary. Decoding non-UTF-8 bytes as text
      // is lossy (invalid sequences become U+FFFD) but never throws.
      return new TextDecoder("utf-8", { fatal: false }).decode(this.binaryFiles.get(path))
    }
    return null
  }
  async write(path: string, content: string): Promise<void> {
    this.binaryFiles.delete(path)
    this.files.set(path, content)
  }
  async readBinary(path: string): Promise<Uint8Array | null> {
    if (this.binaryFiles.has(path)) return this.binaryFiles.get(path) as Uint8Array
    if (this.files.has(path)) return new TextEncoder().encode(this.files.get(path) as string)
    return null
  }
  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    this.files.delete(path)
    this.binaryFiles.set(path, data)
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path)
    this.binaryFiles.delete(path)
  }
  async list(prefix = ""): Promise<string[]> {
    const paths = new Set<string>([...this.files.keys(), ...this.binaryFiles.keys()])
    return [...paths].filter((p) => p.startsWith(prefix)).sort()
  }
  snapshot(): Map<string, string> {
    return new Map(this.files)
  }
}
