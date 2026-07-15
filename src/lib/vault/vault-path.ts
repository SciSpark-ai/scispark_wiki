import { homedir } from "node:os"
import { join } from "node:path"

/** Vault root on disk: SCISPARK_VAULT env override, else ~/SciSpark/vault. */
export function resolveVaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SCISPARK_VAULT?.trim()
  if (fromEnv) return fromEnv
  return join(homedir(), "SciSpark", "vault")
}
