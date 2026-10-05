import { randomUUID } from "node:crypto"
import { z } from "zod"
import { DigestSchema, ProfileIdSchema, UuidSchema } from "../extensions/contracts"
import { applyRecoverableChangeset, parseChangeset } from "../vault/changesets"
import { withVaultExclusive } from "../vault/exclusive"
import { parseDocument, serializeDocument } from "../vault/frontmatter"
import { loadRouting, validateFilesAgainstRouting } from "../wiki/schema-routing"
import type { Changeset } from "../vault/types"
import type { WorkflowContext } from "./context"
import { ArtifactIdsSchema, WikiProposalInputSchema, type WikiProposalInput, type WorkflowLease } from "./contracts"
import { assertWorkflowPath, assertOutputOwner, readArtifact } from "./artifacts"
import { canonicalJson } from "./journal"
import { readRun } from "./store"

const ChangesetSchema = z.unknown().transform(value => parseChangeset(value))
const SaveSchema = z.object({ artifactIds: ArtifactIdsSchema, changeset: ChangesetSchema, state: z.enum(["pending", "saved"]), operations: z.array(UuidSchema) }).strict()
const OutputsSchema = z.object({
  schemaVersion: z.literal(1), runId: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  completed: z.boolean(), automaticOperationId: UuidSchema,
  proposal: z.object({ artifactIds: ArtifactIdsSchema, changeset: ChangesetSchema }).strict().optional(),
  saves: z.array(SaveSchema),
}).strict()
type Outputs = z.infer<typeof OutputsSchema>
const outputPath = (id: string) => `.scispark/tool-runs/${UuidSchema.parse(id)}/outputs.json`
const selection = (ids: string[]) => ArtifactIdsSchema.parse(ids).slice().sort()
async function load(ctx: WorkflowContext, id: string): Promise<Outputs> {
  await assertWorkflowPath(ctx, `.scispark/tool-runs/${UuidSchema.parse(id)}/run.json`)
  if (!await readRun(ctx, id)) throw new Error("Workflow run not found")
  await assertWorkflowPath(ctx, outputPath(id))
  const raw = await ctx.storage.read(outputPath(id))
  const outputs = raw === null ? OutputsSchema.parse({ schemaVersion: 1, runId: id, profileId: ctx.profileId, vaultId: ctx.vaultId, completed: false, automaticOperationId: randomUUID(), saves: [] }) : OutputsSchema.parse(JSON.parse(raw))
  if (outputs.runId !== id || outputs.profileId !== ctx.profileId || outputs.vaultId !== ctx.vaultId) throw new Error("Workflow outputs owner mismatch")
  return outputs
}
async function persist(ctx: WorkflowContext, outputs: Outputs) {
  await assertWorkflowPath(ctx, outputPath(outputs.runId))
  await ctx.storage.write(outputPath(outputs.runId), JSON.stringify(OutputsSchema.parse(outputs)))
}
async function locked<T>(ctx: WorkflowContext, id: string, work: () => Promise<T>): Promise<T> {
  UuidSchema.parse(id)
  await assertWorkflowPath(ctx, `.scispark/locks/workflow-${id}`)
  return withVaultExclusive(ctx.storage, `workflow-${id}`, work)
}
/** This is an output checkpoint, never a second lifecycle journal. */
export async function workflowOutputsCompleted(ctx: WorkflowContext, id: string): Promise<boolean> { return (await load(ctx, id)).completed }
export async function markWorkflowOutputsCompleted(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<void> {
  await locked(ctx, id, async () => {
    await assertOutputOwner(ctx, id, lease)
    const outputs = await load(ctx, id); outputs.completed = true; await persist(ctx, outputs)
  })
}
async function validateWikiChanges(ctx: WorkflowContext, cs: Changeset) {
  parseChangeset(cs)
  await assertWorkflowPath(ctx, "schema.md")
  const files = cs.changes.map(change => {
    if (!change.path.startsWith("wiki/")) throw new Error("Proposal must target wiki Markdown pages")
    const document = parseDocument((change.after ?? change.before)!)
    return { path: change.path, type: document.frontmatter.type }
  })
  if (validateFilesAgainstRouting(files, await loadRouting(ctx.storage)).length) throw new Error("Proposal does not match wiki schema routing")
}
/** Task 10/14 handoff: adapters return complete validated changes, tied to an
 * exact artifact selection. Never apply a native proposal outside this journal.
 * Submission is inert; only explicit save or update_wiki completion applies it. */
export async function submitWikiProposal(ctx: WorkflowContext, id: string, input: WikiProposalInput, lease?: WorkflowLease): Promise<void> {
  const value = WikiProposalInputSchema.parse(input), ids = selection(value.artifactIds)
  await locked(ctx, id, async () => {
    if (lease) await assertOutputOwner(ctx, id, lease)
    const outputs = await load(ctx, id), run = (await readRun(ctx, id))!
    const artifacts = await Promise.all(ids.map(a => readArtifact(ctx, id, a)))
    const changeset = parseChangeset({ id: outputs.proposal?.changeset.id ?? randomUUID(), skill: `workflow:${run.tool.skillId}`, model: run.model.tierModels.strong.model, timestamp: outputs.proposal?.changeset.timestamp ?? new Date().toISOString(), changes: value.changes })
    await validateWikiChanges(ctx, changeset)
    const sources = changeset.changes.flatMap(c => c.after === null ? [] : parseDocument(c.after).frontmatter.sources)
    for (const ref of artifacts.flatMap(a => a.metadata.sourceRefs)) if (!sources.includes(ref)) throw new Error("Proposal must preserve artifact source references")
    const proposal = { artifactIds: ids, changeset }
    if (outputs.proposal) {
      if (canonicalJson(outputs.proposal) !== canonicalJson(proposal)) throw new Error("Workflow proposal conflict")
      return
    }
    if (outputs.completed || outputs.saves.length) throw new Error("Workflow outputs are already finalized")
    outputs.proposal = proposal; await persist(ctx, outputs)
  })
}
async function notes(ctx: WorkflowContext, id: string, ids: string[]): Promise<Changeset> {
  const run = (await readRun(ctx, id))!, timestamp = new Date().toISOString()
  await assertWorkflowPath(ctx, "schema.md")
  const routing = await loadRouting(ctx.storage), directory = routing.note ?? "wiki/notes"
  const changes = []
  for (const artifactId of ids) {
    const { metadata, bytes } = await readArtifact(ctx, id, artifactId)
    const supported = metadata.kind === "bibtex" ? ["application/x-bibtex", "text/x-bibtex", "text/plain"] : ["text/markdown", "text/plain"]
    if (metadata.kind === "file" || !supported.includes(metadata.mediaType.toLowerCase())) throw new Error("Only supported text artifacts can be saved without a wiki proposal")
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    // BibTeX is literal fenced data; Markdown uses the wiki's existing sanitized renderer.
    const fence = "`".repeat((body.match(/`+/g) ?? []).reduce((max, part) => Math.max(max, part.length + 1), 3))
    const after = serializeDocument({ type: "note", title: metadata.title, created: timestamp.slice(0, 10), updated: timestamp.slice(0, 10), tags: [], related: [], sources: metadata.sourceRefs,
      workflow_run: id, workflow_artifact: artifactId, evidence_scope: "Workflow output; source references retained, not independently verified." }, metadata.kind === "bibtex" ? `${fence}bibtex\n${body}\n${fence}` : body)
    changes.push({ path: `${directory}/workflow-${id}-${artifactId}.md`, before: null, after })
  }
  return parseChangeset({ id: randomUUID(), skill: `workflow:${run.tool.skillId}`, model: run.model.tierModels.strong.model, timestamp, changes })
}
async function saveUnderLock(ctx: WorkflowContext, id: string, ids: string[], operationId: string, outputs: Outputs): Promise<{ changesetId: string }> {
  const priorOperation = outputs.saves.find(s => s.operations.includes(operationId))
  if (priorOperation && canonicalJson(priorOperation.artifactIds) !== canonicalJson(ids)) throw new Error("Workflow save operation conflict")
  let save = priorOperation ?? outputs.saves.find(s => canonicalJson(s.artifactIds) === canonicalJson(ids))
  if (!save) {
    if (outputs.proposal && canonicalJson(outputs.proposal.artifactIds) !== canonicalJson(ids)) throw new Error("Select exactly the proposal artifacts to apply its changes")
    // Recheck bytes even for proposal saves, binding provenance to intact artifacts.
    for (const artifactId of ids) {
      const { metadata } = await readArtifact(ctx, id, artifactId)
      if (metadata.kind === "file" || ["text/html", "image/svg+xml"].includes(metadata.mediaType.toLowerCase())) throw new Error("Only supported text artifacts can be saved; file artifacts are download-only")
    }
    const changeset = outputs.proposal?.changeset ?? await notes(ctx, id, ids)
    await validateWikiChanges(ctx, changeset)
    save = { artifactIds: ids, changeset, state: "pending", operations: [operationId] }
    outputs.saves.push(save)
    await persist(ctx, outputs) // Stable identity and exact before/after images precede mutation.
  } else if (!save.operations.includes(operationId)) {
    save.operations.push(operationId); await persist(ctx, outputs)
  }
  if (save.state === "saved") return { changesetId: save.changeset.id }
  // Lock order: workflow journal -> canonical vault mutation transaction.
  // All audit reconciliation and before-image checks occur under that shared
  // boundary, including ordinary changeset apply/revert/undo callers.
  const cs = save.changeset
  await applyRecoverableChangeset(ctx.storage, cs, id)
  save.state = "saved"; await persist(ctx, outputs)
  return { changesetId: cs.id }
}
export async function saveRunToWiki(ctx: WorkflowContext, runId: string, artifactIds: string[], operationId: string): Promise<{ changesetId: string }> {
  const ids = selection(artifactIds); UuidSchema.parse(operationId)
  return locked(ctx, runId, async () => saveUnderLock(ctx, runId, ids, operationId, await load(ctx, runId)))
}
/** Coordinator-only trigger. Check authorization and cancellation under the same
 * lease lock used by lifecycle actions, then use the explicit-save mechanism. */
export async function saveAuthorizedWorkflowOutputs(ctx: WorkflowContext, id: string, lease: WorkflowLease): Promise<void> {
  await locked(ctx, id, async () => {
    await assertOutputOwner(ctx, id, lease)
    const run = (await readRun(ctx, id))!, outputs = await load(ctx, id)
    if (run.writeIntent !== "update_wiki" || !outputs.completed) return
    const ids = outputs.proposal?.artifactIds ?? run.artifacts.map(a => a.id).sort()
    if (ids.length) await saveUnderLock(ctx, id, ids, outputs.automaticOperationId, outputs)
  })
}
