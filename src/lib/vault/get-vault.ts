import type { VaultStorage } from "./storage"
import { MemoryVaultStorage } from "./memory-storage"
import { OpfsVaultStorage } from "./opfs-storage"

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
