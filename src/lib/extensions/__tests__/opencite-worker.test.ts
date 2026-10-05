// Explicit acceptance gates. NEVER part of ordinary offline verification.
// Real managed preparation + real worker + deterministic source transport by
// default; a separate opt-in enables public sources with disposable credentials.
import { describe, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { workflowFixture } from "../../workflows/__tests__/fixtures"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { stageOpenCiteCatalogEntry, openciteCatalogEntry } from "../catalog/opencite"
import { inspectPackage, reviewImport, commitImport } from "../inspect"
import { ensureToolEnvironment, resolvePreparedEnvironmentRefs, resolveToolConnectionRefs, resolveCapturedToolEnvironment } from "../setup"
import { probeSandbox, createCommandContext, runIsolatedCommand } from "../sandbox"
import { bindToolConnection } from "../connections"
import { toolKey } from "../contracts"
import { saveS2Key } from "../../server/paper-source-settings"
import { writeRun, readRun } from "../../workflows/store"
import { claimRunLease, journalStep } from "../../workflows/journal"
import { publishArtifact } from "../../workflows/artifacts"
import { withRunAttemptScope } from "../../workflows/attempt-scope"
import { openCiteWorkflowAdapter } from "../catalog/opencite-adapter"
import type { WorkflowIO } from "../../workflows/adapters"

vi.mock("node:dns/promises",async original=>process.env.SCISPARK_OPENCITE_LIVE==="1"?await original():{lookup:async()=>[{address:"1.1.1.1",family:4}]})
vi.mock("node:https",async original=>process.env.SCISPARK_OPENCITE_LIVE==="1"?await original():{
  request:(url:URL,_options:unknown,callback:(res:Readable)=>void)=>{
    const req=new EventEmitter() as EventEmitter&{end():void}
    req.end=()=>{
      // A minimal real PDF with an extractable text object; deterministic source.
      const parts=["%PDF-1.4\n","1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n","2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n","3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n","4 0 obj\n<< /Length 45 >>\nstream\nBT /F1 12 Tf 72 720 Td (Fixture full text) Tj ET\nendstream\nendobj\n","5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"]
      let pdf=parts.join(""),offset=parts[0].length
      const offsets=parts.slice(1).map(p=>{const result=offset;offset+=p.length;return result})
      pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.map(o=>String(o).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
      const body=url.hostname==="publisher.example"?pdf:JSON.stringify({data:[{paperId:"abc",title:"Fixture paper",authors:[{name:"A Researcher"}],year:2024,externalIds:{DOI:"10.1234/fixture"},url:"https://www.semanticscholar.org/paper/abc",isOpenAccess:true,openAccessPdf:{url:"https://publisher.example/open.pdf"}}]})
      const res=Readable.from([Buffer.from(body)]);Object.assign(res,{statusCode:200});callback(res)
    };return req
  },
})

describe.runIf(process.env.SCISPARK_OPENCITE_REAL_WORKER==="1")("OpenCite real isolated worker acceptance (explicit gate)",()=>{
  it("prepares the exact lock and returns search, full text and BibTeX through the captured production adapter",async()=>{
    // No install or package execution is attempted when real isolation is absent.
    expect(await probeSandbox()).toMatchObject({status:"ready"})
    const base=await realpath(await mkdtemp(join(tmpdir(),"scispark-opencite-acceptance-")))
    try {
      const {ctx,run}=workflowFixture();ctx.runtimeRoot=join(base,"runtime");ctx.vaultPath=join(base,"vault")
      await mkdir(ctx.runtimeRoot);await mkdir(ctx.vaultPath);ctx.storage=new NodeFsVaultStorage(ctx.vaultPath)
      const entry=openciteCatalogEntry(),preview=await inspectPackage(ctx,await stageOpenCiteCatalogEntry(ctx))
      const reviewed=await reviewImport(ctx,preview.id,[entry.proposal])
      const [ref]=await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref])
      const environment=await ensureToolEnvironment(ctx,ref,entry.proposal.setup)
      expect(environment.state).toBe("ready")
      const key=process.env.SCISPARK_OPENCITE_LIVE==="1"?process.env.SCISPARK_OPENCITE_TEST_S2_KEY:"fixture-key-only"
      if(!key)throw new Error("Explicit disposable test source credential required")
      await saveS2Key(ctx.storage,key)
      await bindToolConnection(ctx,toolKey(ref),{id:randomUUID(),service:"semantic-scholar",adapter:"scispark-http-v1",credentialHandle:"settings:paperSources.s2"})
      run.tool=ref;run.input={query:process.env.SCISPARK_OPENCITE_LIVE==="1"?"Attention Is All You Need":"fixture",limit:2,fullText:true}
      run.preparedEnvironmentRefs=await resolvePreparedEnvironmentRefs(ctx,[ref],run.model)
      run.connectionConfigurationRefs=await resolveToolConnectionRefs(ctx,[ref]);await writeRun(ctx,run)
      const lease=await claimRunLease(ctx,run.id);if(!lease)throw new Error("Missing owned lease");run.status="running"
      const io:WorkflowIO={signal:new AbortController().signal,step:(intent,work)=>journalStep(ctx,run.id,lease,intent,work),emit:async()=>{},submitWikiProposal:async()=>{throw new Error("No writes expected")},publishArtifact:input=>publishArtifact(ctx,run.id,input,lease)}
      await withRunAttemptScope(ctx,run.id,async()=>{
        const captured=await resolveCapturedToolEnvironment(ctx,run,ref)
        const command=await createCommandContext(ctx,{kind:"run",id:run.id,packageDigest:ref.digest,executablePaths:Object.fromEntries(Object.entries(captured.executablePaths).filter((row):row is [string,string]=>typeof row[1]==="string")),runtimeReadRoots:captured.runtimeReadRoots})
        const help=await runIsolatedCommand(command,run.id,{id:randomUUID(),executableId:"python",argv:["-I","-m","opencite","--help"],cwd:".",resourceIds:[],connectionIds:[]},io.signal)
        expect(help.exitCode).toBe(0);expect(help.stdout).toContain("search")
        await openCiteWorkflowAdapter.execute(ctx,run,io)
      },io.signal)
      const saved=await readRun(ctx,run.id)
      expect(saved?.artifacts.map(a=>a.kind)).toEqual(expect.arrayContaining(["papers","bibtex","file","markdown"]))
      expect(saved?.usage.commandCalls).toBe(2);expect(saved?.usage.modelCalls).toBe(0)
    }finally{await rm(base,{recursive:true,force:true})}
  },600000)
})
