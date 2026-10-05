import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquirePackage } from "../acquire"
import { inspectPackage, reviewImport, commitImport } from "../inspect"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { ensureToolEnvironment, checkToolReadiness, resolvePreparedEnvironmentRefs, acknowledgeAndDiscardToolSetup, validateDependencyLock, resolveToolPreparationClosure, resolveCapturedToolEnvironment } from "../setup"
import * as toolchains from "../toolchains"
import { commandEnvironment } from "../sandbox-policy"
import { prepareToolchain, ToolchainNeedsSetupError, resolveToolchainPin } from "../toolchains"
import { probeSandbox, runIsolatedCommand } from "../sandbox"
import { writeProfileTools } from "../store"
import { startRun, waitForWorkflowIdle } from "../../workflows/coordinator"
import { sha256 } from "../acquire"
vi.mock("../sandbox", async original => ({ ...await original<typeof import("../sandbox")>(), probeSandbox: vi.fn(), runIsolatedCommand: vi.fn() }))
vi.mock("../toolchains", async original => ({ ...await original<typeof import("../toolchains")>(), prepareToolchain: vi.fn() }))
const roots: string[] = []
beforeEach(() => {
  vi.mocked(probeSandbox).mockResolvedValue({ status: "ready", platform: "fixture", runtimeVersion: "0.0.78", evidence: [] })
  vi.mocked(prepareToolchain).mockImplementation(async (_ctx, _id, _pin, stage) => ({ executablePaths: { node: process.execPath }, runtimeReadRoots: [join(process.execPath,"..","..")], root: stage }))
  vi.mocked(runIsolatedCommand).mockImplementation(async (_ctx,_id, invocation) => ({ invocationId: invocation.id, exitCode: 0, stdout: "", stderr: "", termination: "exited", reconciliationRef: "fixture", uncertain: false }))
})
afterEach(async () => { await waitForWorkflowIdle(); vi.restoreAllMocks(); vi.resetAllMocks(); await Promise.all(roots.splice(0).map(p => rm(p,{recursive:true,force:true}))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(),"scispark-setup-"))); roots.push(root)
  const vaultPath = join(root,"vault"), runtimeRoot = join(root,"runtime"), source = join(root,"source")
  await Promise.all([vaultPath,runtimeRoot,source].map(p => mkdir(p)))
  const lock = JSON.stringify({ name:"fixture", lockfileVersion:3, packages:{"":{name:"fixture",version:"1.0.0"}} })
  await writeFile(join(source,"SKILL.md"),"Fixture instructions")
  await writeFile(join(source,"package.json"),JSON.stringify({name:"fixture",version:"1.0.0"}))
  await writeFile(join(source,"package-lock.json"),lock)
  const ctx = {profileId:"b".repeat(32),vaultId:"a".repeat(64),vaultPath,runtimeRoot,storage:new NodeFsVaultStorage(vaultPath)}
  const preview = await inspectPackage(ctx,await acquirePackage(ctx,{kind:"local-folder",path:source}))
  const recipe = { commands:[], runtimes:["node22"], unsupported:[], environment:{runtime:"node22" as const,lockFile:"package-lock.json",lockDigest:sha256(lock)} }
  const proposal = {...preview.tools[0].proposal,kind:"command" as const,engines:["api","codex","claude-code"],resources:[],setup:recipe}
  const reviewed = await reviewImport(ctx,preview.id,[proposal])
  const [ref] = await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref])
  return {ctx,ref,recipe,source}
}
describe("managed setup lifecycle (deterministic execution fixtures)",()=>{
  it("needs setup initially and refuses execution when isolation is unavailable",async()=>{
    const {ctx,ref,recipe}=await fixture()
    expect((await checkToolReadiness(ctx,ref)).status).toBe("needs-setup")
    vi.mocked(probeSandbox).mockResolvedValue({status:"unsupported",platform:"fixture",runtimeVersion:"0.0.78",evidence:[]})
    expect(await ensureToolEnvironment(ctx,ref,recipe)).toMatchObject({state:"unsupported",executed:false})
    expect(prepareToolchain).not.toHaveBeenCalled(); expect(runIsolatedCommand).not.toHaveBeenCalled()
  })
  it("serializes concurrent setup and captures an exact lock reference",async()=>{
    const {ctx,ref,recipe}=await fixture()
    const [a,b]=await Promise.all([ensureToolEnvironment(ctx,ref,recipe),ensureToolEnvironment(ctx,ref,recipe)])
    expect(a.state).toBe("ready"); expect(a.id).toBe(b.id)
    expect(runIsolatedCommand).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runIsolatedCommand).mock.calls[0][2].argv).toContain("--ignore-scripts")
    expect(await resolvePreparedEnvironmentRefs(ctx,[ref])).toEqual([{id:a.id,digest:a.digest,lockDigest:recipe.environment.lockDigest}])
  })
  it("preserves stable setup ID on known failure and successful retry",async()=>{
    const {ctx,ref,recipe}=await fixture()
    vi.mocked(runIsolatedCommand).mockResolvedValueOnce({invocationId:crypto.randomUUID(),exitCode:1,stdout:"",stderr:"",termination:"exited",reconciliationRef:"fixture",uncertain:false})
    const failed=await ensureToolEnvironment(ctx,ref,recipe), ready=await ensureToolEnvironment(ctx,ref,recipe)
    expect(failed.state).toBe("interrupted"); expect(ready.state).toBe("ready"); expect(ready.setupId).toBe(failed.setupId)
  })
  it("does not retry uncertain staging or accept changed recipes",async()=>{
    const {ctx,ref,recipe}=await fixture()
    vi.mocked(runIsolatedCommand).mockResolvedValueOnce({invocationId:crypto.randomUUID(),exitCode:null,stdout:"",stderr:"",termination:"worker-lost",reconciliationRef:"fixture",uncertain:true})
    const failed=await ensureToolEnvironment(ctx,ref,recipe)
    expect(failed.state).toBe("needs-reconciliation")
    expect((await ensureToolEnvironment(ctx,ref,recipe)).setupId).toBe(failed.setupId)
    expect(runIsolatedCommand).toHaveBeenCalledTimes(1)
    await expect(ensureToolEnvironment(ctx,ref,{...recipe,environment:{...recipe.environment,lockDigest:"c".repeat(64)}})).rejects.toThrow("reviewed")
  })
  it("keeps another profile outside the cache",async()=>{
    const {ctx,ref,recipe}=await fixture(); await ensureToolEnvironment(ctx,ref,recipe)
    await expect(ensureToolEnvironment({...ctx,profileId:"c".repeat(32)},ref,recipe)).rejects.toThrow("imported")
  })
  it("discards uncertain staging explicitly and idempotently while retaining charged usage across reopen",async()=>{
    const {ctx,ref,recipe}=await fixture()
    vi.mocked(runIsolatedCommand).mockResolvedValueOnce({invocationId:crypto.randomUUID(),exitCode:null,stdout:"",stderr:"",termination:"worker-lost",reconciliationRef:"fixture",uncertain:true})
    const uncertain=await ensureToolEnvironment(ctx,ref,recipe)
    const store=new NodeFsVaultStorage(join(ctx.runtimeRoot,"profiles",ctx.profileId))
    const journalPath=`setup-attempts/${uncertain.setupId}.json`,operation=crypto.randomUUID()
    await store.write(journalPath,JSON.stringify({id:uncertain.setupId,profileId:ctx.profileId,vaultId:ctx.vaultId,attempts:[{id:crypto.randomUUID(),hash:"e".repeat(64),seconds:300,activeSeconds:0.2,state:"unknown"}]}))
    const reopened={...ctx,storage:new NodeFsVaultStorage(ctx.vaultPath)}
    expect((await acknowledgeAndDiscardToolSetup(reopened,ref,uncertain.setupId,operation)).state).toBe("interrupted")
    const usage=JSON.parse((await store.read(journalPath))!)
    expect(usage.attempts).toHaveLength(1);expect(usage.attempts[0]).toMatchObject({state:"known",activeSeconds:300,discardedBy:operation})
    const ready=await ensureToolEnvironment(reopened,ref,recipe)
    expect(ready.state).toBe("ready");expect(ready.setupId).toBe(uncertain.setupId)
    expect((await acknowledgeAndDiscardToolSetup(reopened,ref,ready.setupId,operation)).state).toBe("ready")
    expect(await resolvePreparedEnvironmentRefs(reopened,[ref])).toHaveLength(1)
    expect(await store.read(journalPath)).toBe(JSON.stringify(usage))
  })
  it("rejects unhashed, alternate registry and executable Python dependency locks",()=>{
    const node={commands:[],runtimes:[],unsupported:[],environment:{runtime:"node22" as const,lockFile:"package-lock.json",lockDigest:"a".repeat(64)}}
    for(const packages of [{"node_modules/pkg":{resolved:"https://evil.invalid/pkg.tgz",integrity:"sha512-aaaa"}},{"node_modules/pkg":{resolved:"https://registry.npmjs.org/pkg.tgz"}}])expect(()=>validateDependencyLock(node,JSON.stringify({lockfileVersion:3,packages}))).toThrow("lock")
    const python={...node,environment:{...node.environment,runtime:"python3.12" as const,lockFile:"requirements.txt"}}
    for(const value of ["thing>=1","thing==1.0","-e https://evil.invalid/pkg","--extra-index-url=https://evil.invalid"])expect(()=>validateDependencyLock(python,value)).toThrow("exact")
    expect(()=>validateDependencyLock(python,"thing==1.0 --hash=sha256:"+"a".repeat(64))).not.toThrow()
  })
  it("captures every declared helper candidate and fails before setup rather than retargeting later",async()=>{
    const {ctx,ref,recipe,source}=await fixture()
    const preview=await inspectPackage(ctx,await acquirePackage(ctx,{kind:"local-folder",path:source,packageId:"fixture-root"}))
    const reviewed=await reviewImport(ctx,preview.id,[{...preview.tools[0].proposal,engines:["api","codex","claude-code"],dependencySlots:[{id:"helper",capability:"research",eligible:[ref]}]}])
    const [root]=await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref])
    expect((await resolveToolPreparationClosure(ctx,root)).dependencies).toEqual([ref])
    await expect(resolvePreparedEnvironmentRefs(ctx,[root,ref])).rejects.toThrow("needs setup")
    await writeProfileTools(ctx,{schemaVersion:1,enabled:[{tool:root,enabled:true}],pins:[root],overrides:[],migrated:true})
    const request={operationId:crypto.randomUUID(),tool:root,input:{},contextRefs:[],writeIntent:"outputs_only" as const}
    await expect(startRun(ctx,request)).rejects.toThrow("needs setup")
    expect(await ctx.storage.list(".scispark/tool-runs/")).toEqual([])
    const ready=await ensureToolEnvironment(ctx,ref,recipe)
    expect(await resolvePreparedEnvironmentRefs(ctx,[root,ref])).toEqual([{id:ready.id,digest:ready.digest,lockDigest:ready.lockDigest}])
    const run=await startRun(ctx,request)
    expect(run.dependencies).toEqual([ref])
    expect(run.preparedEnvironmentRefs).toEqual([{id:ready.id,digest:ready.digest,lockDigest:ready.lockDigest}])
    await waitForWorkflowIdle()
    const stage=join(ctx.runtimeRoot,"profiles",ctx.profileId,"commands/setup",ready.setupId,"output")
    await writeFile(join(stage,"project/package.json"),"tampered")
    await expect(resolvePreparedEnvironmentRefs(ctx,[ref])).rejects.toThrow("integrity")
  })

  it("reports missing host prerequisites before command execution",async()=>{
    const {ctx,ref,recipe}=await fixture()
    vi.mocked(prepareToolchain).mockRejectedValueOnce(new ToolchainNeedsSetupError("Required host build prerequisite is unavailable: cc"))
    expect(await ensureToolEnvironment(ctx,ref,recipe)).toMatchObject({state:"needs-setup",executed:false,reason:"Required host build prerequisite is unavailable: cc"})
    expect(runIsolatedCommand).not.toHaveBeenCalled()
  })

  it("pins exact official artifacts and rejects changed archive bytes before executing them",async()=>{
    const {ctx,ref}=await fixture(),setupId=crypto.randomUUID()
    const stage=join(ctx.runtimeRoot,"profiles",ctx.profileId,"commands/setup",setupId,"output")
    await mkdir(stage,{recursive:true});await writeFile(join(stage,"runtime.tar.gz"),"not the official archive")
    const pin=resolveToolchainPin("node22")
    expect(pin.version).toBe("22.22.0");expect(pin.url).toMatch(/^https:\/\/nodejs.org\/dist\/v22.22.0\//)
    const python=resolveToolchainPin("python3.12")
    expect(python).toMatchObject({version:"3.12.12",sha256:"fb85a13414b028c49ba18bbd523c2d055a30b56b18b92ce454ea2c51edc656c4"})
    const actual=await vi.importActual<typeof import("../toolchains")>("../toolchains")
    await expect(actual.prepareToolchain(ctx,setupId,pin,stage,ref.digest)).rejects.toThrow("checksum")
    expect(runIsolatedCommand).not.toHaveBeenCalled()
  })

  it("runs reviewed Python helpers with the populated venv and its PATH (execution fixture)",async()=>{
    const {ctx,source}=await fixture()
    const lock="locked-helper==1.0 --hash=sha256:"+"a".repeat(64)
    await writeFile(join(source,"requirements.txt"),lock)
    const preview=await inspectPackage(ctx,await acquirePackage(ctx,{kind:"local-folder",path:source,packageId:"python-fixture"}))
    const recipe={commands:[{executable:"python",argv:["-m","locked_helper"],network:[]},{executable:"python3.12",argv:["-m","locked_helper"],network:[]},{executable:"pip",argv:["check"],network:[]}],runtimes:["python3.12"],unsupported:[],environment:{runtime:"python3.12" as const,lockFile:"requirements.txt",lockDigest:sha256(lock)}}
    const reviewed=await reviewImport(ctx,preview.id,[{...preview.tools[0].proposal,kind:"command",engines:["api"],setup:recipe}])
    const [ref]=await commitImport(ctx,reviewed.id,[reviewed.tools[0].manifest.ref])
    vi.mocked(prepareToolchain).mockImplementation(async(_ctx,_id,_pin,stage)=>{
      const root=join(stage,"runtime");await mkdir(join(root,"bin"),{recursive:true})
      await writeFile(join(root,"bin/python3.12"),"inert base interpreter fixture")
      return {root,executablePaths:{python:join(root,"bin/python3.12")},runtimeReadRoots:[root]}
    })
    let venv="",helperExecutions=0
    const scopes:Parameters<typeof runIsolatedCommand>[0][]=[]
    vi.mocked(runIsolatedCommand).mockImplementation(async(scope,id,invocation)=>{
      scopes.push(scope)
      let success=true
      if(invocation.argv.includes("venv")){
        venv=invocation.argv.at(-1)!;await mkdir(join(venv,"bin"),{recursive:true});await writeFile(join(venv,"bin/python"),"inert venv interpreter fixture")
      }else if(invocation.argv.includes("--require-hashes")){
        expect(invocation.argv).toContain(join(venv,"bin/python"))
        await mkdir(join(venv,"lib/python3.12/site-packages"),{recursive:true})
        await writeFile(join(venv,"lib/python3.12/site-packages/locked_helper.py"),"fixture helper installed by mocked pip")
      }else{
        success=scope.commandScope.executablePaths.python===join(venv,"bin/python")
          && commandEnvironment(scope.commandScope).PATH?.split(":")[0]===join(venv,"bin")
          && (await readFile(join(venv,"lib/python3.12/site-packages/locked_helper.py"),"utf8")).includes("fixture helper")
        if(success)helperExecutions++
      }
      return {invocationId:invocation.id,exitCode:success?0:1,stdout:"",stderr:"",termination:"exited",reconciliationRef:`setup-attempts/${id}.json`,uncertain:false}
    })
    const result=await ensureToolEnvironment(ctx,ref,recipe)
    expect(result.state).toBe("ready");expect(helperExecutions).toBe(3)
    expect(new Set(scopes.map(scope=>scope.commandScope.id))).toEqual(new Set([result.setupId]))
    expect(scopes.at(-1)?.commandScope).toMatchObject({kind:"setup",registryDomains:["pypi.org","files.pythonhosted.org"]})
    expect(scopes.at(-1)?.commandScope).not.toHaveProperty("researchRoot")
  })

  it("restores retained toolchain pins after current release selection changes",async()=>{
    const {ctx,ref,recipe}=await fixture()
    const ready=await ensureToolEnvironment(ctx,ref,recipe)
    await writeProfileTools(ctx,{schemaVersion:1,enabled:[{tool:ref,enabled:true}],pins:[ref],overrides:[],migrated:true})
    const run=await startRun(ctx,{operationId:crypto.randomUUID(),tool:ref,input:{},contextRefs:[],writeIntent:"outputs_only"})
    await waitForWorkflowIdle()
    const captured=await resolveCapturedToolEnvironment(ctx,run,ref)
    const pin=resolveToolchainPin("node22")
    const current=vi.spyOn(toolchains,"resolveToolchainPin").mockReturnValue({...pin,version:"22.99.0",sha256:"e".repeat(64)})
    await expect(resolveCapturedToolEnvironment(ctx,run,ref)).resolves.toEqual(captured)
    expect(current).not.toHaveBeenCalled()
    const storage=new NodeFsVaultStorage(join(ctx.runtimeRoot,"profiles",ctx.profileId))
    await storage.write(`environments/${ready.id}/toolchain-pin.json`,JSON.stringify({...pin,version:"22.99.0"}))
    await expect(resolveCapturedToolEnvironment(ctx,run,ref)).rejects.toThrow("pin")
  })

})
