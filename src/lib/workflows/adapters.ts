import { z } from "zod"
import { ToolRefSchema, UuidSchema } from "../extensions/contracts"
import type { WorkflowContext } from "./context"
import type { Artifact, ArtifactInput, WikiProposalInput, RunEventInput, StepIntent, ToolRun } from "./contracts"

export interface WorkflowIO {
  step<T>(intent: StepIntent, work: () => Promise<T>): Promise<T>
  emit(event: RunEventInput): Promise<void>
  publishArtifact(input: ArtifactInput): Promise<Artifact>
  submitWikiProposal(input: WikiProposalInput): Promise<void>
  signal: AbortSignal
}
export const HelperInvocationSchema = z.object({ frameId: UuidSchema, tool: ToolRefSchema, input: z.record(z.string(), z.unknown()) }).strict()
export const HelperResultSchema = z.object({ summary: z.string().max(32000), artifactIds: z.array(UuidSchema).max(100) }).strict()
export type HelperInvocation = z.infer<typeof HelperInvocationSchema>
export type HelperResult = z.infer<typeof HelperResultSchema>
export interface WorkflowAdapter {
  /** Explicit supporting entrypoint. Root identity/configuration stays unchanged.
   * Derive step IDs from invocation.frameId; all attempts use the root IO/scope.
   * The host journals opaque enter/return without another reservation. */
  executeHelper?(ctx: WorkflowContext, root: ToolRun, invocation: HelperInvocation, io: WorkflowIO): Promise<HelperResult>
  execute(ctx: WorkflowContext, run: ToolRun, io: WorkflowIO): Promise<void>
}

const runtime = globalThis as typeof globalThis & { __scisparkWorkflowAdapters?: Map<string, WorkflowAdapter> }
const adapters = runtime.__scisparkWorkflowAdapters ??= new Map()
/** Native entrypoints use their registered name; generic hosts use the manifest kind.
 * Adapter lookup never resolves or substitutes the immutable tool version. */
export function registerWorkflowAdapter(kind: string, adapter: WorkflowAdapter): void {
  if (!kind.trim() || typeof adapter.execute !== "function") throw new Error("Invalid workflow adapter")
  adapters.set(kind, adapter)
}
const instructionAdapter: WorkflowAdapter = {
  execute: async (ctx, run, io) => {
    const { executeInstructionWorkflow } = await import("./agent")
    await executeInstructionWorkflow(ctx, run, io)
  },
}
export function getWorkflowAdapter(kind: string): WorkflowAdapter | undefined {
  return adapters.get(kind) ?? (kind === "instructions" ? instructionAdapter : kind === "scispark-opencite-v1.py" ? openCiteAdapter : undefined)
}

// Production lazy registration also works before asynchronous recovery begins.
const openCiteAdapter: WorkflowAdapter = {
  execute: async (ctx, run, io) => (await import("../extensions/catalog/opencite-adapter")).openCiteWorkflowAdapter.execute(ctx, run, io),
  executeHelper: async (ctx, root, invocation, io) => (await import("../extensions/catalog/opencite-adapter")).openCiteWorkflowAdapter.executeHelper!(ctx, root, invocation, io),
}
