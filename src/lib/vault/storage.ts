export interface VaultStorage {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  delete(path: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}
