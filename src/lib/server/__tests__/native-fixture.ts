import { randomUUID } from "node:crypto"
import type { VaultStorage } from "../../vault/storage"
import { workflowFixture } from "../../workflows/__tests__/fixtures"
import { NATIVE_TOOL_MANIFESTS } from "../../extensions/native-catalog"
import { writeProfileTools } from "../../extensions/store"
import { setNativeWorkflowContextForTests } from "../native-workflow"

export async function enableNativeFixture(storage: VaultStorage) {
  const ctx = { ...workflowFixture().ctx, profileId: randomUUID(), storage }
  await writeProfileTools(ctx, { schemaVersion: 1, enabled: NATIVE_TOOL_MANIFESTS.map(tool => ({ tool: tool.ref, enabled: true })), pins: [], overrides: [], migrated: true })
  setNativeWorkflowContextForTests(ctx)
  return ctx
}
