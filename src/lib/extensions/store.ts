import { join } from "node:path"
import { withVaultExclusive } from "../vault/exclusive"
import type { WorkflowContext } from "../workflows/context"
import { DigestSchema, ProfileIdSchema, ProfileToolsSchema, type ProfileTools } from "./contracts"

const STATE_PATH = ".scispark/tools/state.json"
export function extensionObjectPath(ctx: WorkflowContext, digest: string): string {
  return join(ctx.runtimeRoot, "objects", DigestSchema.parse(digest))
}
export function profileRuntimePath(ctx: WorkflowContext): string {
  return join(ctx.runtimeRoot, "profiles", ProfileIdSchema.parse(ctx.profileId))
}
export async function readProfileTools(ctx: WorkflowContext): Promise<ProfileTools | null> {
  ProfileIdSchema.parse(ctx.profileId)
  DigestSchema.parse(ctx.vaultId)
  const raw = await ctx.storage.read(STATE_PATH)
  return raw === null ? null : ProfileToolsSchema.parse(JSON.parse(raw))
}
export async function writeProfileTools(ctx: WorkflowContext, state: ProfileTools): Promise<void> {
  await updateProfileTools(ctx, () => state)
}

/** One exclusion boundary owns the read/modify/atomic-write cycle. Callers must
 * not nest writeProfileTools under the same profile-tools lock. */
export async function updateProfileTools(ctx: WorkflowContext, update: (current: ProfileTools | null) => Promise<ProfileTools> | ProfileTools): Promise<ProfileTools> {
  ProfileIdSchema.parse(ctx.profileId)
  DigestSchema.parse(ctx.vaultId)
  return withVaultExclusive(ctx.storage, "profile-tools", async () => {
    const current = await readProfileTools(ctx)
    const state = ProfileToolsSchema.parse(await update(current))
    if (JSON.stringify(current) !== JSON.stringify(state)) await ctx.storage.write(STATE_PATH, JSON.stringify(state, null, 2))
    return state
  })
}
