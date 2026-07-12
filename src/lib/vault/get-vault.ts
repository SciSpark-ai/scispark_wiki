import type { VaultStorage } from "./storage"
import { MemoryVaultStorage } from "./memory-storage"
import { OpfsVaultStorage } from "./opfs-storage"
import { openVault } from "./scaffold"

let vaultPromise: Promise<VaultStorage> | null = null

export function getVault(): Promise<VaultStorage> {
  if (!vaultPromise) {
    if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function") {
      // Best-effort: request persistent storage to reduce eviction risk (spec: 02-system.md).
      // Fire-and-forget — must not block or fail vault creation.
      navigator.storage.persist?.().catch(() => {})
      vaultPromise = OpfsVaultStorage.create()
    } else {
      vaultPromise = Promise.resolve(new MemoryVaultStorage())
    }
  }
  return vaultPromise
}

let openVaultPromise: Promise<VaultStorage> | null = null

/** App entry point: resolves the storage backend and ensures the vault is
 * bootstrapped (schema.md etc. exist), running openVault exactly once on success.
 * On rejection, clears the memoized promise so the next call retries (transient
 * failures like OPFS quota or Web Locks issues should not permanently brick the app). */
export function getOpenVault(): Promise<VaultStorage> {
  if (!openVaultPromise) {
    openVaultPromise = getVault()
      .then(async (storage) => {
        await openVault(storage)
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
