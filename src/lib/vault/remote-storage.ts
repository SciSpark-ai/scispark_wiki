import type { VaultStorage } from "./storage"

/** Extracts a server-provided {error} message from a non-ok Response body,
 * falling back to the HTTP status text when the body isn't parseable JSON. */
async function errorMessageFor(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (parsed && typeof parsed.error === "string") return parsed.error
    } catch {
      // not JSON — fall through to status text
    }
  }
  return res.statusText || `request failed with status ${res.status}`
}

/** VaultStorage over the /api/vault routes — the browser's view of the local vault. */
export class RemoteVaultStorage implements VaultStorage {
  private fetchFn: typeof fetch
  private base: string

  constructor(fetchFn: typeof fetch = fetch, base = "") {
    // Every request below is issued as `this.fetchFn(...)` — a METHOD call
    // whose receiver is this instance. The native `fetch` throws
    // "Failed to execute 'fetch' on 'Window': Illegal invocation" when its
    // receiver is anything but the global object, so storing the bare global
    // here bricks every browser vault read/write. Wrap it so the underlying
    // fetch is always invoked as a plain call (receiver = global via normal
    // scoping). An injected fetchFn (tests, custom base) is wrapped the same
    // way, which is harmless for the receiver-agnostic mocks used in tests.
    this.fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => fetchFn(input, init)) as typeof fetch
    this.base = base
  }

  private fileUrl(path: string): string {
    return `${this.base}/api/vault/file?path=${encodeURIComponent(path)}`
  }

  async read(path: string): Promise<string | null> {
    const bytes = await this.readBinary(path)
    if (bytes === null) return null
    return new TextDecoder("utf-8").decode(bytes)
  }

  async write(path: string, content: string): Promise<void> {
    const res = await this.fetchFn(this.fileUrl(path), {
      method: "PUT",
      headers: { "x-vault-text": "1" },
      body: new TextEncoder().encode(content),
    })
    if (!res.ok) throw new Error(await errorMessageFor(res))
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    const res = await this.fetchFn(this.fileUrl(path), { method: "GET" })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(await errorMessageFor(res))
    return new Uint8Array(await res.arrayBuffer())
  }

  async writeBinary(path: string, data: Uint8Array): Promise<void> {
    const res = await this.fetchFn(this.fileUrl(path), {
      method: "PUT",
      body: data as Uint8Array<ArrayBuffer>,
    })
    if (!res.ok) throw new Error(await errorMessageFor(res))
  }

  async delete(path: string): Promise<void> {
    const res = await this.fetchFn(this.fileUrl(path), { method: "DELETE" })
    if (!res.ok) throw new Error(await errorMessageFor(res))
  }

  async list(prefix = ""): Promise<string[]> {
    const res = await this.fetchFn(`${this.base}/api/vault/list?prefix=${encodeURIComponent(prefix)}`, {
      method: "GET",
    })
    if (!res.ok) throw new Error(await errorMessageFor(res))
    const { paths } = (await res.json()) as { paths: string[] }
    return paths
  }
}
