export interface VaultStorage {
  /** Same local directory across separately bundled server routes/instances. */
  readonly coordinationKey?: string
  /** Server backends provide cross-process exclusion; browser proxies never execute jobs. */
  exclusive?<T>(name: string, work: () => Promise<T>): Promise<T>
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  /** Reads raw bytes. Works for paths written via either write() or writeBinary() —
   * a text path's content is returned as its UTF-8 encoding. Returns null if missing. */
  readBinary(path: string): Promise<Uint8Array | null>
  /** Writes raw bytes losslessly. Callers know which paths are binary; read()ing a
   * binary path back as text may return a lossy/mojibake decoding (see implementations). */
  writeBinary(path: string, data: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}
