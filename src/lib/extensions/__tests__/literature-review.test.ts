// @vitest-environment node
import { describe, expect, it } from "vitest"
import { literatureReviewCatalogEntry } from "../catalog/literature-review"
import { HostDecisionSchema } from "../../workflows/host-tools"
import { checkFixtureScience, fixtureReport, reviewCorpus } from "../../../../e2e/fixtures/tools/literature-review"

describe("imported literature review (offline evidence only)", () => {
  it("pins the full local protocol and its supporting graph", () => {
    const entry = literatureReviewCatalogEntry()
    expect(entry.proposal.kind).toBe("instructions")
    expect(entry.source).toMatchObject({ ref: "f0219bde233abb44d8a0c5d73f41ea27073e1493" })
    expect(entry.proposal.dependencies.length).toBeGreaterThanOrEqual(4)
  })
  it("bounds typed parallel strands to two fixed named dependencies", () => {
    const tool = literatureReviewCatalogEntry().proposal.dependencies[0]
    expect(HostDecisionSchema.safeParse({ type: "parallel", branches: [{ tool, input: {} }, { tool, input: {} }] }).success).toBe(true)
    expect(HostDecisionSchema.safeParse({ type: "parallel", branches: Array(3).fill({ tool, input: {} }) }).success).toBe(false)
  })
  it("samples every claim against a hand-checked passage key and checks question coverage", () => {
    expect(fixtureReport.sourceIds.every(id => reviewCorpus.some(p => p.id === id))).toBe(true)
    expect(fixtureReport.unsupportedComparisons).toContain("clinical performance")
    expect(() => checkFixtureScience(fixtureReport)).not.toThrow()
    const wrong = structuredClone(fixtureReport)
    wrong.claims[0].text = "A is clinically superior to B." as never
    expect(() => checkFixtureScience(wrong)).toThrow("Unsupported claim")
    const incomplete = structuredClone(fixtureReport)
    incomplete.coverage["clinical performance"] = "supported"
    expect(() => checkFixtureScience(incomplete)).toThrow("coverage")
    const duplicated = structuredClone(fixtureReport)
    duplicated.claims = Array(5).fill(duplicated.claims[0])
    expect(() => checkFixtureScience(duplicated)).toThrow("claim sampling")
  })
})

it("stages the hash-verified complete graph through the real generic importer", async () => {
  const { mkdtemp, mkdir, rm, realpath } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os"), { join } = await import("node:path")
  const { workflowFixture } = await import("../../workflows/__tests__/fixtures")
  const { stageOpenCiteCatalogEntry, openciteCatalogEntry } = await import("../catalog/opencite")
  const { stageLiteratureReviewCatalogEntry, literatureReviewCatalogGraph } = await import("../catalog/literature-review")
  const { inspectPackage, reviewImport, commitImport } = await import("../inspect")
  const base = await realpath(await mkdtemp(join(tmpdir(), "scispark-literature-import-")))
  try {
    const { ctx } = workflowFixture(); ctx.runtimeRoot = join(base, "runtime"); await mkdir(ctx.runtimeRoot)
    const graph = literatureReviewCatalogGraph()
    const openPreview = await inspectPackage(ctx, await stageOpenCiteCatalogEntry(ctx))
    const openReview = await reviewImport(ctx, openPreview.id, [openciteCatalogEntry().proposal])
    expect(openReview.tools[0].manifest.ref).toEqual(graph.opencite.manifest.ref)
    await commitImport(ctx, openReview.id, [openReview.tools[0].manifest.ref])
    const preview = await inspectPackage(ctx, await stageLiteratureReviewCatalogEntry(ctx), graph.nodes.map(n => n.proposal.skillId))
    expect(preview.tools.every(t => !t.reviewed)).toBe(true)
    const reviewed = await reviewImport(ctx, preview.id, graph.nodes.map(n => n.proposal))
    expect(reviewed.tools.map(t => t.manifest.ref)).toEqual(graph.nodes.map(t => t.manifest.ref))
    const refs = await commitImport(ctx, reviewed.id, [graph.root.manifest.ref])
    expect(refs).toEqual([graph.root.manifest.ref])
    expect(await (await import("../store")).readImportedManifests(ctx)).toHaveLength(6)
  } finally { await rm(base, { recursive: true, force: true }) }
})

it("runs the bounded six-paper review through coordinator/import/host and recovers collection without repeat attempts (offline adapters)", async () => {
  const { vi } = await import("vitest")
  const { mkdtemp, mkdir, rm, realpath } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os"), { join } = await import("node:path"), { randomUUID } = await import("node:crypto")
  const { workflowFixture } = await import("../../workflows/__tests__/fixtures")
  const { NodeFsVaultStorage } = await import("../../vault/node-fs-storage")
  const { stageOpenCiteCatalogEntry, openciteCatalogEntry } = await import("../catalog/opencite")
  const { stageLiteratureReviewCatalogEntry, literatureReviewCatalogGraph } = await import("../catalog/literature-review")
  const { inspectPackage, reviewImport, commitImport } = await import("../inspect")
  const setup = await import("../setup"), connections = await import("../connections"), sandbox = await import("../sandbox"), network = await import("../network-broker")
  const settings = await import("../../llm/settings")
  const { startRun, waitForWorkflowIdle, observeRun } = await import("../../workflows/coordinator")
  const { withWorkflowAttempt } = await import("../../workflows/attempt-scope")
  const { withVaultExclusive } = await import("../../vault/exclusive")
  const { UsageJournalSchema } = await import("../../workflows/contracts")
  const base = await realpath(await mkdtemp(join(tmpdir(), "scispark-literature-coordinator-")))
  const { ctx } = workflowFixture(); ctx.runtimeRoot = join(base, "runtime"); ctx.vaultPath = join(base, "vault")
  await mkdir(ctx.runtimeRoot); await mkdir(ctx.vaultPath); ctx.storage = new NodeFsVaultStorage(ctx.vaultPath)
  try {
    const graph = literatureReviewCatalogGraph(), ref = (name: string) => graph.nodes.find(n => n.proposal.skillId === `host/${name}/SKILL.md`)!.manifest.ref
    const op = await inspectPackage(ctx, await stageOpenCiteCatalogEntry(ctx)), reviewedOp = await reviewImport(ctx, op.id, [openciteCatalogEntry().proposal])
    await commitImport(ctx, reviewedOp.id, [graph.opencite.manifest.ref])
    const p = await inspectPackage(ctx, await stageLiteratureReviewCatalogEntry(ctx), graph.nodes.map(n => n.proposal.skillId))
    const r = await reviewImport(ctx, p.id, graph.nodes.map(n => n.proposal))
    await commitImport(ctx, r.id, [graph.root.manifest.ref])
    await settings.saveSettings(ctx.storage, { ...settings.DEFAULT_SETTINGS, engines: { kind: "codex", timeoutSeconds: 120, models: { codex: { fast: "fixture-fast", strong: "fixture-strong" }, "claude-code": { fast: "unused-fast", strong: "unused-strong" } } } })
    // Deterministic adapter seams only. No production flag can manufacture readiness.
    vi.spyOn(setup, "resolvePreparedEnvironmentRefs").mockResolvedValue([])
    vi.spyOn(setup, "resolveToolConnectionRefs").mockResolvedValue([])
    vi.spyOn(setup, "resolveCapturedToolEnvironment").mockResolvedValue({ projectRoot: "/fixture/prepared", executablePaths: { python: "/fixture/python" }, runtimeReadRoots: [] } as never)
    vi.spyOn(connections, "capturedOpenCiteConnections").mockResolvedValue({ bindings: [] } as never)
    vi.spyOn(network, "createConnectionBroker").mockResolvedValue({ handles: [], close: async () => {} })
    vi.spyOn(sandbox, "createCommandContext").mockResolvedValue({ ...ctx, commandScope: {} } as never)
    const helperRuns: { rootRunId: string }[] = []
    let commandActive = 0, commandMaximum = 0
    const command = vi.spyOn(sandbox, "runIsolatedCommand").mockImplementation(async (_context, rootRunId, invocation, signal) => {
      helperRuns.push({ rootRunId })
      return withVaultExclusive(ctx.storage, "fixture-command-dispatch", () => withWorkflowAttempt(ctx, rootRunId,
        { id: invocation.id, kind: "command", replay: "reconcile", inputHash: "a".repeat(64) }, { modelCalls: 0, commandCalls: 1, activeSeconds: 300, costUsd: null, accountingOwner: "workflow" }, async () => {
          commandActive++; commandMaximum = Math.max(commandMaximum, commandActive)
          const query = JSON.parse(invocation.argv.at(-1)!).query
          const corpus = reviewCorpus.filter(p => p.strand === query && p.access !== "missing")
          const papers = corpus.map(p => ({ title: p.id, authors: [{ name: "Fixture", family_name: "Fixture", given_name: "" }], year: 2026, ids: { doi: `10.1234/${p.id}`, pmid: "", pmcid: "", openalex_id: "", s2_id: p.id, arxiv_id: "" }, citation_count: 0, url: `https://example.org/${p.id}`, is_oa: true, oa_status: "gold", data_sources: ["s2"], abstract: p.passage, pdf_locations: [{ url: `https://example.org/${p.id}.pdf`, source: "s2", is_oa: true, version: "", license: "CC0" }] }))
          const documents = corpus.flatMap((p, paperIndex) => p.access === "full-text" ? [{ paperIndex, url: `https://example.org/${p.id}.pdf`, status: "ok", pdfBase64: Buffer.from(`%PDF-1.4\nInvented fixture ${p.id}`).toString("base64"), markdown: p.passage }] : [])
          const result = { invocationId: invocation.id, exitCode: 0, stdout: JSON.stringify({ schemaVersion: 1, packageVersion: "0.5.4", sourceStatus: "ok", papers, documents, bibtex: corpus.map(p => `@article{${p.id},title={Invented ${p.id}}}`).join("\n") }), stderr: "", termination: "exited" as const, reconciliationRef: "offline-fixture", uncertain: false }
          commandActive--
          return { value: result, result: { modelCalls: 0, commandCalls: 1, activeSeconds: 0, costUsd: null, outcome: "known" } }
        }, signal))
    })
    const publish = (title: string, text: string, sourceRefs: string[] = []) => ({ type: "publish_artifact", kind: "markdown", title, mediaType: "text/markdown", text, sourceRefs })
    const prose = fixtureReport.claims.map(c => `${c.text} [${c.sourceId}](https://example.org/${c.sourceId})\n> ${c.passage}`).join("\n\n") + "\n\nClinical performance is unsupported. A leads on X, B on noisy Y. b3 is missing; a3/b2 are abstract-only."
    const finish = (summary: string) => ({ type: "finish", synthesize: false, summary, artifactIds: [] })
    const complete = vi.fn(async (model: string, request: import("../../llm/types").LLMRequest) => {
      const prompt = JSON.parse(request.messages[1].content as string), turn = prompt.observations.length
      const role = prompt.request.role ?? "root"
      expect(model).toBe(role === "root" ? "fixture-strong" : "fixture-fast")
      let json: unknown
      if (role === "root") {
        if (turn >= 2) {
          const strands = JSON.parse(prompt.observations[1]).parallel
          const collected = strands.flatMap((b: { result: string }) => JSON.parse(b.result))
          expect(collected).toEqual([...reviewCorpus])
        }
        const actions = [publish("_briefs/strands.md", "Methods: compare benchmark accuracy. Robustness: compare noise and domain shift. Clinical performance requested but may be unsupported."),
          { type: "parallel", branches: ["methods", "robustness"].map(strand => ({ tool: ref("collection"), input: { role: "collection", strand } })) },
          publish("research/synthesis/ontology-map-gap-scope.md", JSON.stringify(fixtureReport), fixtureReport.sourceIds),
          { type: "invoke_skill", tool: ref("manuscript-writing"), input: { role: "writing", manuscript: prose } },
          { type: "invoke_skill", tool: ref("paper-review"), input: { role: "review", manuscript: prose, target: "local Markdown direction paper" } },
          { type: "invoke_skill", tool: ref("humanizer"), input: { role: "final", manuscript: prose } },
          { ...finish("Retained citation-grounded partial review; clinical comparison unsupported."), artifactIds: [JSON.parse(prompt.observations[0] ?? "null")?.id].filter(Boolean) }]
        json = actions[turn]
      } else if (role === "collection") {
        const corpus = reviewCorpus.filter(p => p.strand === prompt.request.strand)
        const collectionIds: string[] = turn ? JSON.parse(prompt.observations[0]).artifactIds : []
        const observed = prompt.artifacts.filter((a: { id: string; mediaType: string }) => collectionIds.includes(a.id) && ["application/json", "text/markdown"].includes(a.mediaType))
        const reads = observed.map((a: { id: string }) => ({ type: "read_artifact", artifactId: a.id, offset: 0, length: 16000 }))
        if (turn > reads.length) {
          const observedText = prompt.observations.slice(1, 1 + reads.length).map((o: string) => JSON.parse(o).text).join("\n")
          for (const paper of corpus.filter(p => p.access !== "missing")) expect(observedText).toContain(paper.passage)
        }
        const actions = [{ type: "invoke_skill", tool: graph.opencite.manifest.ref, input: { query: prompt.request.strand, limit: 3, fullText: true } }, ...reads,
          publish(`research/collection/${prompt.request.strand}/cards-source-meta-index.md`, corpus.map(p => `# ${p.id}/card.md\nAccess: ${p.access}\n${p.claim}\n\n## source.md\n${p.passage || "Source missing; no evidence available."}\n\n## meta.json\n${JSON.stringify({ sourceId: p.id, access: p.access, redistribution_ok: false, notes: p.access === "missing" ? "No source available" : "Invented offline source" })}`).join("\n"), corpus.map(p => p.id)), finish(JSON.stringify(corpus))]
        json = actions[turn]
      } else if (role === "writing") json = [{ type: "invoke_skill", tool: ref("humanizer"), input: { role: "polish", manuscript: prose } }, publish("direction-papers/comparison-direction.md", prose, fixtureReport.sourceIds), finish("Draft retained with all five cited passages.")][turn]
      else if (role === "review") {
        expect(prompt.request).not.toHaveProperty("authoringRationale")
        json = [publish("direction-papers/self-review.md", "Synopsis: partial evidence. Major: clinical performance cannot be compared; source b3 missing. Methods, statistics, logic, reproducibility, absent figures and prose checked against provided text; abstract-only constraints retained. Canonical lookup unavailable."), finish("Self-review identifies limitations; it is not scientific validation.")][turn]
      } else if (role === "final") json = [publish("direction-papers/final-cited-synthesis.md", prose, fixtureReport.sourceIds), finish("Final prose preserves cited claims and unsupported comparison.")][turn]
      else json = finish(prose)
      if (!json) throw new Error(`Unexpected fixture action ${role}:${turn}`)
      return { json, text: JSON.stringify(json), usage: { inputTokens: 100, outputTokens: 50 }, provider: "openai", model, stopReason: "stop" as const }
    })
    vi.spyOn(settings, "buildProvider").mockReturnValue({ id: "openai", billingMode: "subscription", complete, preflight: async () => {} } as never)
    const write = ctx.storage.write.bind(ctx.storage); let interrupted = false, callsAfterCollection = 0
    vi.spyOn(ctx.storage, "write").mockImplementation(async (path, value) => {
      if (path.endsWith("host-continuation.json")) {
        const state = JSON.parse(value)
        if (!interrupted && !state.parallel && state.frames[0]?.observations.some((o: string) => o.includes('"parallel"'))) { interrupted = true; callsAfterCollection = complete.mock.calls.length; await (await import("../../workflows/journal")).transitionRun(ctx, state.runId, "interrupted"); throw new Error("Synthetic owner loss after durable collection") }
      }
      return write(path, value)
    })
    const run = await startRun(ctx, { operationId: randomUUID(), tool: graph.root.manifest.ref, input: { question: "Compare benchmark accuracy, robustness and clinical performance." }, contextRefs: [], writeIntent: "outputs_only" })
    await waitForWorkflowIdle()
    expect(interrupted).toBe(true)
    const final = await observeRun(ctx, run.id)
    expect(final.status).toBe("completed")
    expect(final.dependencies).toHaveLength(5)
    expect(final.usage.commandCalls).toBe(2)
    expect(final.usage.modelCalls).toBe(26)
    expect(callsAfterCollection).toBe(13)
    expect(final.allowance.modelCalls).toBe(30)
    expect(command).toHaveBeenCalledTimes(2); expect(commandMaximum).toBe(1)
    expect(helperRuns.every(r => r.rootRunId === run.id)).toBe(true)
    const reportArtifact = final.artifacts.find(a => a.title === "research/synthesis/ontology-map-gap-scope.md")!
    checkFixtureScience(JSON.parse((await ctx.storage.read(reportArtifact.path))!))
    expect(final.artifacts.some(a => a.kind === "bibtex")).toBe(true)
    expect(final.artifacts.filter(a => a.kind === "file")).toHaveLength(3)
    const finalArtifact = final.artifacts.find(a => a.title === "direction-papers/final-cited-synthesis.md")!
    expect(await ctx.storage.read(finalArtifact.path)).toBe(prose)
    expect((await ctx.storage.list("wiki/")).length).toBe(0)
    const usage = UsageJournalSchema.parse(JSON.parse((await ctx.storage.read(`.scispark/tool-runs/${run.id}/usage.json`))!))
    expect(usage.attempts.every(a => a.ticket.runId === run.id)).toBe(true)
    expect(usage.attempts).toHaveLength(28)
  } finally { await waitForWorkflowIdle(); vi.restoreAllMocks(); await rm(base, { recursive: true, force: true }) }
}, 30000)
