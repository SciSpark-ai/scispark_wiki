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
        const safeReasons: Record<string, string> = {
          "Required provider/model change needs explicit selection": "Choose a supported engine and model in Manage.",
          "Review the imported tool": "Review and confirm the import before running it.",
          "Required service adapter is unavailable": "This service has no supported connection. Review the tool adapter.",
          "Bind Semantic Scholar and configure its credential": "Connect Semantic Scholar in Manage, then add its key in Settings.",
          "Prepare a managed environment": "Prepare the required environment in Manage.",
          "Prepared environment integrity needs repair": "The prepared environment needs repair. Open Manage to prepare it again.",
          "Command isolation is unavailable": "Command isolation is unavailable on this computer. Use a supported host with a passing isolation check.",
          "Internal model calls require a metered adapter": "This tool needs a metered model adapter before it can run.",
        }
        const specific = checked.reasons.map(reason => safeReasons[reason]).filter(Boolean)
        result.readiness = { status: checked.status, reasons: specific.length ? [...new Set(specific)] : [saved ? projectToolSetup(saved).reason : checked.status === "unsupported" ? "This tool needs a supported execution adapter. Review its requirements in Manage." : "Prepare the required environment in Manage."] }
        result.blockedTool = { tool: ref, name }
        result.setup = saved ? projectToolSetup(saved) : undefined
      } else if (saved && !result.setup) result.setup = projectToolSetup(saved)
    }
  } catch {
    result.readiness = { status: "needs-setup", reasons: ["Review the model and required dependencies in Manage."] }
  }
  return ToolObservationSchema.parse(result)
}
