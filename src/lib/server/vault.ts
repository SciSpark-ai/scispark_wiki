import type { VaultStorage } from "../vault/storage"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { resolveVaultRoot } from "../vault/vault-path"
import { openVault } from "../vault/scaffold"
import { cookies, headers } from "next/headers"
import { getProfileSession, initializeLocalProfiles } from "./local-profiles"
import { PROFILE_COOKIE, PROFILE_HEADER } from "../local-profile-contract"

const vaults = new Map<string, Promise<VaultStorage>>()
let testOverride: VaultStorage | null = null

/** Test hook: force the server vault (pass null to clear). */
export function setServerVaultForTests(storage: VaultStorage | null): void {
  testOverride = storage
  vaults.clear()
}

/** Cache storage by root, never by a mutable global active profile. */
export function openServerVault(root: string): Promise<VaultStorage> {
  if (!vaults.has(root)) {
    const pending = (async () => {
      const storage = new NodeFsVaultStorage(root)
      await openVault(storage)
      return storage
    })().catch((err) => {
      vaults.delete(root)
      throw err
    })
    vaults.set(root, pending)
  }
  return vaults.get(root)!
}

/** Startup recovery and the opt-in scheduler retain their explicit configured vault. */
export async function getDefaultServerVault(): Promise<VaultStorage> {
  if (testOverride) return testOverride
  // Startup recovery opens/scaffolds this vault before the profile UI. Capture
  // new versus legacy origin first, so a fresh launch never inherits tools.
  await initializeLocalProfiles()
  return openServerVault(resolveVaultRoot())
}

/** Resolve the request's session once before handing storage to background work. */
export async function getServerVault(): Promise<VaultStorage> {
  if (testOverride) return testOverride
  const profile = await getProfileSession((await cookies()).get(PROFILE_COOKIE)?.value)
  const expected = (await headers()).get(PROFILE_HEADER)
  if (!profile || (expected !== null && expected !== profile.id)) throw new Error("Open a local profile to access its vault")
  return openServerVault(profile.vaultPath)
}
