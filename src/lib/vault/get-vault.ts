import type { VaultStorage } from "./storage"
import { MemoryVaultStorage } from "./memory-storage"
import { RemoteVaultStorage } from "./remote-storage"
import { openVault } from "./scaffold"

let vaultPromise: Promise<VaultStorage> | null = null

export function getVault(): Promise<VaultStorage> {
  if (!vaultPromise) {
    if (typeof window !== "undefined") {
      // Browser: reads/writes go through the local vault API (/api/vault/*),
      // which is backed by the server-side NodeFsVaultStorage. The server owns
      // scaffolding, so no openVault() call is needed on this path.
      vaultPromise = Promise.resolve(new RemoteVaultStorage())
    } else {
      vaultPromise = Promise.resolve(new MemoryVaultStorage())
    }
  }
  return vaultPromise
}

let openVaultPromise: Promise<VaultStorage> | null = null

/** App entry point: resolves the storage backend. For the Memory fallback
 * (non-browser/test contexts), also ensures the vault is bootstrapped
 * (schema.md etc. exist), running openVault exactly once on success. The
 * remote/browser path skips this — the server scaffolds its own vault.
 * On rejection, clears the memoized promise so the next call retries (transient
 * failures should not permanently brick the app). */
export function getOpenVault(): Promise<VaultStorage> {
  if (!openVaultPromise) {
    openVaultPromise = getVault()
      .then(async (storage) => {
        if (storage instanceof MemoryVaultStorage) {
          await openVault(storage)
        }
        return storage
      })
      .catch((err) => {
        // On rejection, clear memoization so next call retries, not returns cached error.
        openVaultPromise = null
        throw err
      })
  }
  return openVaultPromise
}
