import { createHash } from "node:crypto"
import { mkdir, realpath } from "node:fs/promises"
import { join, sep } from "node:path"
import { cookies, headers } from "next/headers"
import { ProfileIdSchema } from "../extensions/contracts"
import { PROFILE_COOKIE, PROFILE_HEADER, type LocalProfile } from "../local-profile-contract"
import { getProfileRegistryRoot, getProfileSession } from "../server/local-profiles"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import type { VaultStorage } from "../vault/storage"

export interface WorkflowContext {
  profileId: string
  vaultId: string
  vaultPath: string
  runtimeRoot: string
  storage: VaultStorage
}

/** Explicit owning profile also permits recovery without the browser's selection. */
export async function resolveWorkflowContext(profile: LocalProfile, env: NodeJS.ProcessEnv = process.env, readOnly = false): Promise<WorkflowContext> {
  const profileId = ProfileIdSchema.parse(profile.id)
  const registry = await getProfileRegistryRoot(env)
  const runtime = join(registry, "extensions")
  if (!readOnly) {
    await mkdir(profile.vaultPath, { recursive: true })
    await mkdir(runtime, { recursive: true, mode: 0o700 })
  }
  const [vaultPath, runtimeRoot] = await Promise.all([
    realpath(/* turbopackIgnore: true */ profile.vaultPath), realpath(/* turbopackIgnore: true */ runtime),
  ])
  // Compare the actual execution root, not its registry parent: new profile
  // vaults legitimately live under registry/vaults alongside extensions.
  if (vaultPath === runtimeRoot || vaultPath.startsWith(runtimeRoot + sep) || runtimeRoot.startsWith(vaultPath + sep)) {
    throw new Error("Workflow runtime and research vault roots must not overlap")
  }
  return { profileId, vaultId: createHash("sha256").update(vaultPath).digest("hex"), vaultPath, runtimeRoot, storage: new NodeFsVaultStorage(vaultPath) }
}

/** Capture authenticated ownership once before dispatching background work. */
export async function getWorkflowContext(): Promise<WorkflowContext> {
  const profile = await getProfileSession((await cookies()).get(PROFILE_COOKIE)?.value)
  const expected = (await headers()).get(PROFILE_HEADER)
  if (!profile || (expected !== null && expected !== profile.id)) throw new Error("Open a local profile to access its workflows")
  return resolveWorkflowContext(profile)
}
