import { join } from "node:path"
import { z } from "zod"
import { listSessions } from "../chat/session"
import { listProjects } from "../projects/repository"
import { loadBundle } from "../vault/bundle"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { UuidSchema } from "../extensions/contracts"
import { profileRuntimePath } from "../extensions/store"
import type { WorkflowContext } from "./context"
import { readRun } from "./store"
import { workflowHash } from "./journal"

const ResearchViewSchema = z.object({ runId: UuidSchema, resources: z.array(z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/), sourceRef: z.string(), title: z.string(), text: z.string(),
}).strict()) }).strict()
export type ResearchView = z.infer<typeof ResearchViewSchema>
/** Freeze a typed, research-only export. Never copy .scispark wholesale, raw chat
 * records, settings, credentials, spend journals or other profiles to commands. */
export async function buildResearchView(ctx: WorkflowContext, runId: string): Promise<ResearchView> {
  if (!await readRun(ctx, runId)) throw new Error("Workflow run not found")
  const path = `.scispark/tool-runs/${runId}/research-view.json`
  const raw = await ctx.storage.read(path)
  let view: ResearchView
  if (raw !== null) {
    view = ResearchViewSchema.parse(JSON.parse(raw))
    if (view.runId !== runId) throw new Error("Research view owner mismatch")
  } else {
    const resources: ResearchView["resources"] = []
    const add = (sourceRef: string, title: string, text: string) => resources.push({ id: workflowHash(sourceRef), sourceRef, title, text })
    const bundle = await loadBundle(ctx.storage)
    if (bundle.errors.some(e => e.kind === "parse")) throw new Error("Research pages need repair before projection")
    for (const page of bundle.pages.values()) add(page.id, page.frontmatter.title, page.body)
    for (const chat of await listSessions(ctx.storage)) add(`chat:${chat.id}`, chat.title, JSON.stringify({ title: chat.title, projectId: chat.projectId,
      messages: chat.messages.map(m => ({ role: m.role, content: m.content, citedPageIds: m.citedPageIds, readSourcesOnly: m.readSourcesOnly, skippedPageIds: m.skippedPageIds, truncatedPageIds: m.truncatedPageIds })) }))
    for (const project of await listProjects(ctx.storage)) add(`project:${project.id}`, project.title, JSON.stringify({ title: project.title,
      description: project.description, instructions: project.instructions, members: project.members.map(m => ({ id: m.id, title: m.title, type: m.type })) }))
    view = ResearchViewSchema.parse({ runId, resources: resources.sort((a,b) => a.id.localeCompare(b.id)) })
    await ctx.storage.write(path, JSON.stringify(view))
  }
  const runtime = new NodeFsVaultStorage(ctx.runtimeRoot)
  if (await runtime.hasSymlinkTraversal(`profiles/${ctx.profileId}/projections/${runId}`)) throw new Error("Research projection alias")
  const projection = new NodeFsVaultStorage(join(profileRuntimePath(ctx), "projections", runId))
  for (const resource of view.resources) await projection.write(`${resource.id}.txt`, resource.text)
  await projection.write("index.json", JSON.stringify(view.resources.map(({ id, sourceRef, title }) => ({ id, sourceRef, title }))))
  return view
}
