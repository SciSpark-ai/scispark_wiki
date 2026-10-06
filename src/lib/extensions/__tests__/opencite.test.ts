import { describe, expect, it } from "vitest"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import fixture from "./fixtures/opencite-output.json"
import { normalizeOpenCiteOutput, openciteCatalogEntry } from "../catalog/opencite"
import { validateDependencyLock } from "../setup"

describe("OpenCite 0.5.4 reviewed Semantic Scholar slice (deterministic output fixtures)", () => {
  it("pins source and complete hash-locked recipe; preserves required notices", async () => {
    const entry = openciteCatalogEntry()
    expect(entry.source.kind === "github" ? entry.source.ref : undefined).toBe("f0219bde233abb44d8a0c5d73f41ea27073e1493")
    expect(entry.proposal.connections).toEqual(["semantic-scholar"])
    const lock = await readFile("src/lib/extensions/catalog/opencite/requirements.lock", "utf8")
    expect(createHash("sha256").update(lock).digest("hex")).toBe(entry.proposal.setup.environment?.lockDigest)
    expect(() => validateDependencyLock(entry.proposal.setup, lock)).not.toThrow()
    for (const name of ["opencite-LICENSE", "research-skills-LICENSE"]) expect(await readFile(`src/lib/extensions/catalog/opencite/${name}`, "utf8")).toContain("Copyright")
  })
  it("preserves DOI/URL provenance and does not call an advertised PDF accessible", () => {
    const result = normalizeOpenCiteOutput(fixture)
    expect(result.papers[0].doi).toBe(fixture.papers[0].ids.doi)
    expect(result.papers[0].url).toBe(fixture.papers[0].url)
    expect(result.papers[0].access).toBe("abstract")
    expect(result.papers[0].sourceRefs).toContain(fixture.papers[0].pdf_locations[0].url)
    expect(result.artifacts.map(a => a.kind)).toEqual(["papers", "bibtex"])
  })
  it.each([false, true])("preserves inert HTTP paper/PDF provenance with requested full text=%s", fullText => {
    const paperUrl="http://www.semanticscholar.org/paper/abc",pdfUrl="http://papers.example.org/open.pdf"
    const input=structuredClone(fixture)
    input.papers[0].url=paperUrl;input.papers[0].pdf_locations[0].url=pdfUrl
    const result=normalizeOpenCiteOutput({...input,documents:fullText?[{paperIndex:0,url:pdfUrl,status:"unavailable"}]:[]})
    expect(result.sourceStatus).toBe("ok")
    expect(result.papers[0]).toMatchObject({url:paperUrl,doi:fixture.papers[0].ids.doi,access:"abstract"})
    expect(result.papers[0].sourceRefs).toEqual(expect.arrayContaining([paperUrl,pdfUrl]))
    expect(result.artifacts.map(a=>a.kind)).toEqual(["papers","bibtex"])
    expect(result.artifacts.every(a=>a.sourceRefs.includes(pdfUrl))).toBe(true)
  })
  it("never accepts successful HTTP document content as retrieved full text",()=>{
    const input=structuredClone(fixture),url="http://papers.example.org/open.pdf"
    input.papers[0].pdf_locations[0].url=url
    expect(()=>normalizeOpenCiteOutput({...input,documents:[{paperIndex:0,url,status:"ok",pdfBase64:Buffer.from("%PDF-1.4\nfixture").toString("base64"),markdown:"forged"}]})).toThrow()
  })
  it("validates a PDF/Markdown/BibTeX bundle and retains source links", () => {
    const result = normalizeOpenCiteOutput({...fixture, documents:[{paperIndex:0,url:fixture.papers[0].pdf_locations[0].url,status:"ok",pdfBase64:Buffer.from("%PDF-1.4\nfixture").toString("base64"),markdown:"# Fixture full text"}]})
    expect(result.papers[0].access).toBe("full-text")
    expect(result.artifacts.map(a=>a.kind)).toEqual(["papers","bibtex","file","markdown"])
  })
  it("distinguishes no results, rate limiting and no accessible PDF", () => {
    expect(normalizeOpenCiteOutput({...fixture,papers:[],bibtex:""}).sourceStatus).toBe("no-results")
    expect(normalizeOpenCiteOutput({...fixture,papers:[],bibtex:"",sourceStatus:"rate-limited"}).sourceStatus).toBe("rate-limited")
    expect(normalizeOpenCiteOutput({...fixture,documents:[{paperIndex:0,url:fixture.papers[0].pdf_locations[0].url,status:"unavailable"}]}).papers[0].access).toBe("abstract")
  })
  it("rejects schema drift, unobserved documents, invalid PDF bytes and path fields", () => {
    for (const value of [{...fixture,packageVersion:"0.6.0"},{...fixture,papers:[{title:"changed"}]},{...fixture,documents:[{paperIndex:0,url:"https://evil.example/a.pdf",status:"ok",pdfBase64:"YWJj",markdown:"x"}]},{...fixture,outputPath:"/tmp/arbitrary"}]) expect(()=>normalizeOpenCiteOutput(value)).toThrow()
  })
})

// Synthetic orchestration uses actual import snapshots and artifact validation;
// mocked prepared runtime/worker is explicitly not execution acceptance.
describe("OpenCite production adapter and root helper handoff", () => {
  it("stages and reviews through normal import, dispatches captured roots, journals per frame and replays without another command", async () => {
    const {mkdtemp,mkdir,realpath,rm}=await import("node:fs/promises"),{tmpdir}=await import("node:os"),{join}=await import("node:path"),{randomUUID}=await import("node:crypto")
    const {vi}=await import("vitest")
    const {workflowFixture}=await import("../../workflows/__tests__/fixtures")
    const {stageOpenCiteCatalogEntry,OPENCITE_ENTRYPOINT}=await import("../catalog/opencite")
    const {inspectPackage,reviewImport,commitImport}=await import("../inspect")
    const {getWorkflowAdapter}=await import("../../workflows/adapters")
    const prepared=await import("../setup"),sandbox=await import("../sandbox"),connections=await import("../connections"),network=await import("../network-broker")
    const base=await realpath(await mkdtemp(join(tmpdir(),"scispark-opencite-fixture-")))
    try {
      const {ctx,run}=workflowFixture();ctx.runtimeRoot=join(base,"runtime");await mkdir(ctx.runtimeRoot)
      const stage=await stageOpenCiteCatalogEntry(ctx),preview=await inspectPackage(ctx,stage)
      expect(preview.tools[0].reviewed).toBe(false)
      const reviewed=await reviewImport(ctx,preview.id,[openciteCatalogEntry().proposal])
      const [ref]=await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref])
      run.dependencies=[ref];run.status="running"
      const original=structuredClone(run)
      const captured=vi.spyOn(prepared,"resolveCapturedToolEnvironment").mockResolvedValue({projectRoot:"/fixture/prepared/project",executablePaths:{python:"/fixture/venv/bin/python"},runtimeReadRoots:["/fixture/venv"]} as never)
      const capturedConnections=vi.spyOn(connections,"capturedOpenCiteConnections").mockResolvedValue({bindings:[{id:randomUUID(),service:"semantic-scholar"}]} as never)
      const close=vi.fn(async()=>{});vi.spyOn(network,"createConnectionBroker").mockResolvedValue({handles:[],close})
      const context=vi.spyOn(sandbox,"createCommandContext").mockResolvedValue({...ctx,commandScope:{}} as never)
      const command=vi.spyOn(sandbox,"runIsolatedCommand").mockResolvedValue({invocationId:randomUUID(),exitCode:0,stdout:JSON.stringify(fixture),stderr:"",termination:"exited",reconciliationRef:"fixture",uncertain:false})
      const cached=new Map<string,unknown>(),ids:string[]=[]
      const io:import("../../workflows/adapters").WorkflowIO={signal:new AbortController().signal,emit:async()=>{},submitWikiProposal:async()=>{},step:async(intent,work)=>{ids.push(intent.id);if(!cached.has(intent.id))cached.set(intent.id,await work());return cached.get(intent.id) as never},publishArtifact:async input=>({id:randomUUID(),kind:input.kind,title:input.title,mediaType:input.mediaType,sourceRefs:input.sourceRefs,path:"fixture",sha256:"a".repeat(64)})}
      const adapter=getWorkflowAdapter(OPENCITE_ENTRYPOINT)!
      expect(adapter.executeHelper).toBeTypeOf("function")
      const invocation={frameId:randomUUID(),tool:ref,input:{query:"a '; $(touch nope)",limit:1}}
      const result=await adapter.executeHelper!(ctx,run,invocation,io)
      await adapter.executeHelper!(ctx,run,invocation,io)
      await adapter.executeHelper!(ctx,run,{...invocation,frameId:randomUUID()},io)
      expect(result.artifactIds).toHaveLength(2);expect(command).toHaveBeenCalledTimes(2)
      expect(ids[0]).toBe(ids[1]);expect(ids[2]).not.toBe(ids[0])
      expect(captured).toHaveBeenCalledWith(ctx,run,ref);expect(captured.mock.calls[0][1]).toBe(run)
      expect(capturedConnections).toHaveBeenCalledWith(ctx,run.connectionConfigurationRefs)
      expect(command.mock.calls[0][1]).toBe(run.id)
      expect(command.mock.calls[0][2].argv).toEqual(["-I","/fixture/prepared/project/scispark-opencite-v1.py",JSON.stringify({query:invocation.input.query,limit:1,fullText:false})])
      expect(context.mock.calls[0][1]).toMatchObject({id:run.id,packageDigest:ref.digest,executablePaths:{python:"/fixture/venv/bin/python"}})
      expect(run).toEqual(original);expect(close).toHaveBeenCalledTimes(2)
      await expect(adapter.executeHelper!(ctx,run,{...invocation,input:{query:"x",argv:["evil"]}},io)).rejects.toThrow()
      await expect(adapter.executeHelper!(ctx,run,{...invocation,tool:{...ref,digest:"f".repeat(64)}},io)).rejects.toThrow("captured root")
    } finally {vi.restoreAllMocks();await rm(base,{recursive:true,force:true})}
  })
})

it("retains a valid PDF when conversion fails and preserves a bounded safe reason", () => {
  const result=normalizeOpenCiteOutput({...fixture,fullTextRequested:true,documents:[{paperIndex:0,url:fixture.papers[0].pdf_locations[0].url,status:"ok",reason:"conversion-failed",pdfBase64:Buffer.from("%PDF-1.4\nfixture").toString("base64")}]})
  expect(result.papers[0]).toMatchObject({access:"full-text",fullTextStatus:"conversion-failed"})
  expect(result.artifacts.map(a=>a.kind)).toEqual(["papers","bibtex","file"])
})
it.each(["no-location","policy-denied","size-limit","retrieval-failed","invalid-pdf"])("retains safe unavailable full-text reason %s",reason=>{
  const input=structuredClone(fixture)
  if(reason==="no-location")input.papers[0].pdf_locations=[]
  const result=normalizeOpenCiteOutput({...input,fullTextRequested:true,documents:[{paperIndex:0,...(reason==="no-location"?{}:{url:fixture.papers[0].pdf_locations[0].url}),status:"unavailable",reason}]})
  expect(result.papers[0]).toMatchObject({access:"abstract",fullTextStatus:reason})
})
it("rejects raw errors and contradictory content status",()=>{
 const doc={paperIndex:0,url:fixture.papers[0].pdf_locations[0].url,status:"unavailable",reason:"secret raw exception"}
 expect(()=>normalizeOpenCiteOutput({...fixture,documents:[doc]})).toThrow()
 expect(()=>normalizeOpenCiteOutput({...fixture,documents:[{...doc,reason:"conversion-failed"}]})).toThrow()
})
