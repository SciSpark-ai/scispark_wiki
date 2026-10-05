import type { WorkflowContext } from "./context"
import type { RunEventInput, StepIntent, ToolRun } from "./contracts"

export interface WorkflowIO {
  step<T>(intent: StepIntent, work: () => Promise<T>): Promise<T>
  emit(event: RunEventInput): Promise<void>
  signal: AbortSignal
}
export interface WorkflowAdapter {
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
export function getWorkflowAdapter(kind: string): WorkflowAdapter | undefined { return adapters.get(kind) }
