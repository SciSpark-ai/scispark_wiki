import type { VaultStorage } from "./storage"
import { RemoteVaultStorage } from "./remote-storage"

let vault: VaultStorage | null = null

/** Browser-side vault handle. Every read/write proxies to /api/vault/* — the
 * server owns the on-disk vault and its scaffolding, so there is nothing to
 * open or retry here. */
export function getOpenVault(): Promise<VaultStorage> {
  vault ??= new RemoteVaultStorage()
  return Promise.resolve(vault)
}
