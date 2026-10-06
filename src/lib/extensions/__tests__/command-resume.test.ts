// @vitest-environment node
// Simulated supported readiness and bounded worker output: NOT OS acceptance.
import {afterEach,expect,it,vi} from "vitest"
import {mkdtemp,mkdir,writeFile,rm,realpath,readFile} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import {NodeFsVaultStorage} from "../../vault/node-fs-storage"
import {workflowFixture} from "../../workflows/__tests__/fixtures"
import {writeRun} from "../../workflows/store"
import {claimRunLease,journalStep,transitionRun,releaseRunLease,actionOnRun} from "../../workflows/journal"
import {extendAllowance,getRunUsage} from "../../workflows/usage"
import {createCommandContext,runIsolatedCommand} from "../sandbox"
import {launch} from "../sandbox-transport"
import {acquirePackage} from "../acquire"
import {inspectPackage,reviewImport,commitImport} from "../inspect"
vi.mock("../sandbox-probe",()=>({probeSandbox:async()=>({status:"ready",evidence:[],platform:"simulated-offline"})}))
vi.mock("../sandbox-transport",async original=>({...await original<typeof import("../sandbox-transport")>(),launch:vi.fn(async()=>({exitCode:0,stdout:"bounded fixture",stderr:"",termination:"exited"}))}))
const roots:string[]=[]
afterEach(async()=>{vi.clearAllMocks();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
async function fixture(){
 const base=await realpath(await mkdtemp(join(tmpdir(),"command-resume-")));roots.push(base)
 const {ctx,run}=workflowFixture();ctx.vaultPath=join(base,"vault");ctx.runtimeRoot=join(base,"runtime");ctx.storage=new NodeFsVaultStorage(ctx.vaultPath)
 const source=join(base,"source");await mkdir(source);await mkdir(ctx.vaultPath);await mkdir(ctx.runtimeRoot)
 await writeFile(join(source,"SKILL.md"),"---\nname: Resume fixture\n---\nInstructions")
 const preview=await inspectPackage(ctx,await acquirePackage(ctx,{kind:"local-folder",path:source})),reviewed=await reviewImport(ctx,preview.id,preview.tools.map(t=>t.proposal))
 const [ref]=await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref]);run.tool=ref;run.allowance.commandCalls=1;run.usage.commandCalls=1;run.usage.modelCalls=2;run.usage.activeSeconds=4
 await writeRun(ctx,run)
 const command=await createCommandContext(ctx,{kind:"run",id:run.id,packageDigest:ref.digest,executablePaths:{echo:"/bin/echo"},runtimeReadRoots:["/bin","/usr/bin"]})
 return {ctx,run,command}
}
it("continues a pre-dispatch allowance pause once, preserving cumulative counters",async()=>{
 const {ctx,run,command}=await fixture(), id=randomUUID(), intent={id,kind:"command" as const,replay:"reconcile" as const,inputHash:"a".repeat(64)}
 const work=()=>runIsolatedCommand(command,run.id,{id,executableId:"echo",argv:["fixture"],cwd:".",resourceIds:[],connectionIds:[],timeoutMs:1000},new AbortController().signal)
 const lease=(await claimRunLease(ctx,run.id))!
 await expect(journalStep(ctx,run.id,lease,intent,work)).rejects.toThrow("allowance")
 expect(launch).not.toHaveBeenCalled()
 expect(JSON.parse((await ctx.storage.read(`.scispark/tool-runs/${run.id}/steps/${id}.json`))!).state).toBe("not_started")
 await transitionRun(ctx,run.id,"paused_limit",lease);await releaseRunLease(ctx,run.id,lease)
 await extendAllowance(ctx,run.id,randomUUID(),{commandCalls:1})
 await actionOnRun(ctx,run.id,randomUUID(),"resume")
 const continued=(await claimRunLease(ctx,run.id))!
 expect(await journalStep(ctx,run.id,continued,intent,work)).toMatchObject({stdout:"bounded fixture"})
 await journalStep(ctx,run.id,continued,intent,work)
 expect(launch).toHaveBeenCalledTimes(1)
 expect(await getRunUsage(ctx,run.id)).toMatchObject({commandCalls:2,modelCalls:2})
 expect((await getRunUsage(ctx,run.id)).activeSeconds).toBeGreaterThanOrEqual(4)
})
it("never reuses a previous invocation directory or its uncertain output",async()=>{
 const {ctx,run,command}=await fixture(),id=randomUUID(),path=join(command.commandScope.outputRoot,id)
 await extendAllowance(ctx,run.id,randomUUID(),{commandCalls:1});await claimRunLease(ctx,run.id)
 await mkdir(path);await writeFile(join(path,"uncertain.txt"),"retained")
 await expect(runIsolatedCommand(command,run.id,{id,executableId:"echo",argv:[],cwd:".",resourceIds:[],connectionIds:[]},new AbortController().signal)).rejects.toThrow("EEXIST")
 expect(launch).not.toHaveBeenCalled();expect(await readFile(join(path,"uncertain.txt"),"utf8")).toBe("retained")
})
