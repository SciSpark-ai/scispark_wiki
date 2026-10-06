import { z } from "zod"
import { readErrorMessage } from "../http"
import { ToolKeySchema, ToolRefSchema, UuidSchema } from "./contracts"
import { DiscoveryActionSchema, DiscoveryGrantDtoSchema, DiscoveredSkillSchema, DiscoveryStageDtoSchema, ToolMutationSchema, ToolRemovalResultSchema, ToolSetupStateSchema, UpdatePreviewSchema, type DiscoveryAction, type ToolMutation } from "./import-contract"
import { ImportActionSchema, ImportRequestSchema, ImportStateSchema, LibrarySchema, ToolDetailSchema, ToolsActionSchema } from "./ui-contract"
export { toolHref, parseToolIntent } from "./ui-contract"
const updated = z.object({ updated: z.literal(true) }).strict()
const mutationResult = z.union([ToolRefSchema, updated, ToolRemovalResultSchema, ToolSetupStateSchema, UpdatePreviewSchema.nullable()])
async function result<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw new Error(await readErrorMessage(response, "Could not update Tools. Refresh its saved state."))
  return schema.parse((await response.json()).result)
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const toolPath = (key: string) => `/api/tools/${encodeURIComponent(ToolKeySchema.parse(key))}`
export async function listToolsRemote(fetchFn: typeof fetch = fetch) { return result(await fetchFn("/api/tools?view=library", { cache: "no-store" }), LibrarySchema) }
export async function checkToolMetadataRemote(fetchFn: typeof fetch = fetch) { return result(await fetchFn("/api/tools", json({ action: "metadata" })), updated) }
export async function updateToolsProfileRemote(action: z.infer<typeof ToolsActionSchema>, fetchFn: typeof fetch = fetch) { const value = await result(await fetchFn("/api/tools", json(ToolsActionSchema.parse(action))), updated); notifyToolsChanged(); return value }
export async function previewToolImportRemote(input: z.infer<typeof ImportRequestSchema> | File, fetchFn: typeof fetch = fetch) {
  const init = input instanceof File ? { method: "POST", headers: { "content-type": "application/zip" }, body: input } : json(ImportRequestSchema.parse(input))
  return result(await fetchFn("/api/tools/imports", init), DiscoveryStageDtoSchema)
}
export async function inspectToolImportRemote(id: string, fetchFn: typeof fetch = fetch) { return result(await fetchFn(`/api/tools/imports/${UuidSchema.parse(id)}`, { cache: "no-store" }), ImportStateSchema) }
export async function confirmToolImportRemote(id: string, action: z.infer<typeof ImportActionSchema>, fetchFn: typeof fetch = fetch) { const value = await result(await fetchFn(`/api/tools/imports/${UuidSchema.parse(id)}`, json(ImportActionSchema.parse(action))), ImportStateSchema); notifyToolsChanged(); return value }
export async function updateToolVersionRemote(key: string, action: ToolMutation, fetchFn: typeof fetch = fetch) { const value = await result(await fetchFn(toolPath(key), json(ToolMutationSchema.parse(action))), mutationResult); notifyToolsChanged(); return value }
export async function updateToolBindingRemote(key: string, patch: Extract<ToolMutation, { action: "binding" }>["patch"], fetchFn: typeof fetch = fetch) { return updateToolVersionRemote(key, { action: "binding", operationId: crypto.randomUUID(), patch }, fetchFn) }
export async function getToolDetailsRemote(key: string, fetchFn: typeof fetch = fetch) { return result(await fetchFn(toolPath(key), { cache: "no-store" }), ToolDetailSchema) }
export async function discoverAgentSkillsRemote(action: DiscoveryAction, fetchFn: typeof fetch = fetch) {
  return result(await fetchFn("/api/tools/discovery", json(DiscoveryActionSchema.parse(action))), z.union([DiscoveryGrantDtoSchema, z.array(DiscoveredSkillSchema), DiscoveryStageDtoSchema, z.object({ revoked: z.literal(true) }).strict()]))
}
export function notifyToolsChanged() { if (typeof window !== "undefined") window.dispatchEvent(new Event("scispark-tools-changed")) }

export class ToolChoiceRemoteConflict extends Error {
  constructor(readonly choice: import("./contracts").ToolChoice) { super("This choice changed. Select an available tool.") }
}
export async function chooseToolRemote(id: string, tool: import("./contracts").ToolRef, operationId: string, fetchFn: typeof fetch = fetch) {
  const { ChooseToolInputSchema, ToolChoiceSchema } = await import("./contracts")
  const { ToolRunDtoSchema } = await import("../workflows/contracts")
  const response = await fetchFn(`/api/tools/choices/${UuidSchema.parse(id)}`, json(ChooseToolInputSchema.parse({ tool, operationId })))
  if (response.status === 409) {
    const body = await response.json(), choice = ToolChoiceSchema.safeParse(body.choice)
    if (choice.success) throw new ToolChoiceRemoteConflict(choice.data)
    throw new Error("The choice could not be applied. Refresh its saved state.")
  }
  return result(response, ToolRunDtoSchema)
}
