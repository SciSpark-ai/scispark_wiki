import { MemoryVaultStorage } from "../../vault/memory-storage"
import type { WorkflowContext } from "../context"
import type { ToolManifest } from "../../extensions/contracts"
import type { StartRunInput, ToolRun } from "../contracts"

/** No settings, installed tools or participant vaults are read by these fixtures. */
export function workflowFixture() {
  const ctx: WorkflowContext = {
    profileId: "11111111-1111-4111-8111-111111111111", vaultId: "a".repeat(64),
    vaultPath: "/fixture/vault-one", runtimeRoot: "/fixture/extensions",
    storage: new MemoryVaultStorage(),
  }
  const other: WorkflowContext = {
    profileId: "22222222-2222-4222-8222-222222222222", vaultId: "b".repeat(64),
    vaultPath: "/fixture/vault-two", runtimeRoot: "/fixture/extensions",
    storage: new MemoryVaultStorage(),
  }
  const tool: ToolManifest = {
    ref: { packageId: "builtin/research", skillId: "review", version: "1.0.0", digest: "c".repeat(64) },
    name: "Review", description: "Deterministic review fixture", capabilities: ["read"],
    kind: "native", entrypoint: "review", dependencies: [], resources: [], connections: [], engines: ["api"],
    inputSchema: { type: "object" }, outputKinds: ["markdown"],
    provenance: { source: "builtin", locator: "builtin/research", revision: "1.0.0" },
  }
  const request: StartRunInput = {
    operationId: "33333333-3333-4333-8333-333333333333", tool: tool.ref,
    input: { topic: "Hearing" }, contextRefs: [], writeIntent: "outputs_only",
  }
  const run: ToolRun = {
    schemaVersion: 1, id: "44444444-4444-4444-8444-444444444444",
    profileId: ctx.profileId, vaultId: ctx.vaultId, operationId: request.operationId,
    tool: tool.ref, dependencies: [], input: request.input, contextRefs: [],
    model: { engine: "api", tierModels: {
      fast: { provider: "anthropic", model: "claude-haiku-4-5" },
      strong: { provider: "anthropic", model: "claude-opus-4-8" },
    }, roleTiers: { root: "strong", helper: "fast" } },
    preparedEnvironmentRefs: [], connectionConfigurationRefs: [],
    writeIntent: request.writeIntent,
    allowance: { modelCalls: 30, commandCalls: 60, activeSeconds: 1800, costUsd: 2 },
    usage: { modelCalls: 0, commandCalls: 0, activeSeconds: 0, costUsd: 0 },
    status: "queued", createdAt: "2026-10-05T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z",
    eventCursor: 0, artifacts: [],
  }
  return { ctx, other, tool, request, run, dispose: async () => {} }
}
