import type { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { resolveRunModel } from "../workflows/model"
import type { ToolRef } from "./contracts"
import { getToolManifest } from "./registry"
import { readImportedTool } from "./store"
import { checkToolReadiness, readToolEnvironmentState, resolveToolPreparationClosure } from "./setup"
import { projectToolSetup } from "./versions"
import { ToolObservationSchema } from "./ui-contract"

/** Observe owned immutable snapshots only; never acquire, prepare, or contact sources.
 * Every helper uses the root candidate model, matching preparation/run capture. */
export async function observeToolPreparation(ctx: WorkflowContext, root: ToolRef) {
  const result: z.infer<typeof ToolObservationSchema> = { readiness: { status: "ready", reasons: [] }, connectionRequirements: [] }
  try {
    const model = await resolveRunModel(ctx, root)
    if (getToolManifest(root)?.kind === "native") return result
    const closure = await resolveToolPreparationClosure(ctx, root)
    for (const ref of [root, ...closure.dependencies]) {
      if (getToolManifest(ref)?.kind === "native") continue
      const imported = await readImportedTool(ctx, ref), name = imported.manifest.name
      if (imported.manifest.connections.includes("semantic-scholar") && imported.requirements.connectionAdapter === "scispark-http-v1") {
        result.connectionRequirements.push({ tool: ref, name, service: "semantic-scholar" })
      }
      // Keep collecting declared connections after the first blocker, but do not
      // replace its setup identity with an unrelated supporting record.
      if (result.blockedTool) continue
      const checked = await checkToolReadiness(ctx, ref, model)
      const saved = await readToolEnvironmentState(ctx, ref)
      if (checked.status !== "ready") {
        result.readiness = { status: checked.status, reasons: [checked.status === "unsupported" ? "Required execution support is unavailable." : "Review required setup in Manage."] }
        result.blockedTool = { tool: ref, name }
        result.setup = saved ? projectToolSetup(saved) : undefined
      } else if (saved && !result.setup) result.setup = projectToolSetup(saved)
    }
  } catch {
    result.readiness = { status: "needs-setup", reasons: ["Review the model and required dependencies in Manage."] }
  }
  return ToolObservationSchema.parse(result)
}
