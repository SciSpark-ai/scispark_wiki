import type { VaultStorage } from "./storage"
import { MemoryVaultStorage } from "./memory-storage"
import { OpfsVaultStorage } from "./opfs-storage"

let vaultPromise: Promise<VaultStorage> | null = null

export function getVault(): Promise<VaultStorage> {
  if (!vaultPromise) {
    vaultPromise =
      typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"
        ? OpfsVaultStorage.create()
        : Promise.resolve(new MemoryVaultStorage())
  }
  return vaultPromise
}
