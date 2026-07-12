import type { VaultStorage } from "./storage"

export class MemoryVaultStorage implements VaultStorage {
  private files = new Map<string, string>()

  async read(path: string): Promise<string | null> {
    return this.files.has(path) ? (this.files.get(path) as string) : null
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }
  async delete(path: string): Promise<void> {
    this.files.delete(path)
  }
  async list(prefix = ""): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort()
  }
  snapshot(): Map<string, string> {
    return new Map(this.files)
  }
}
