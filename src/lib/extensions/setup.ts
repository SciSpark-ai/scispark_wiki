import { randomUUID } from "node:crypto"
import { lstat, mkdir, readdir, readFile, readlink, realpath, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import type { WorkflowContext } from "../workflows/context"
import type { PreparedEnvironmentRef, RunModel, ToolRun, ConnectionConfigurationRef } from "../workflows/contracts"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { sha256 } from "./acquire"
import { ToolRefSchema, UuidSchema, type ToolRef } from "./contracts"
import { EnvironmentRecordSchema, SetupRecipeSchema, type EnvironmentRecord, type SetupRecipe, type CompatibilityReport } from "./import-contract"
import { ImportedSnapshotSchema, canonicalJSON, extensionObjectPath, importStorage, profileRuntimePath, readImportedManifests, snapshotDigest } from "./store"
import { probeSandbox, createCommandContext, runIsolatedCommand, reconcileSetupAfterDiscard } from "./sandbox"
import { prepareToolchain, resolveToolchainPin, ToolchainPinSchema, SetupInterruptedError, ToolchainNeedsSetupError, type PreparedToolchain } from "./toolchains"
import { connectionRefsForTools, readConnectionRevision } from "./connections"
import { resolveRunModel } from "../workflows/model"
import { getToolManifest } from "./registry"
import { getServerS2Key } from "../server/paper-source-settings"
const digest=(value:unknown)=>sha256(canonicalJSON(value))
const statePath=(ref:ToolRef)=>`environments/by-tool/${digest(ref)}.json`
async function importedTool(ctx:WorkflowContext,ref:ToolRef){
  ToolRefSchema.parse(ref)
  if(!(await readImportedManifests(ctx)).some(m=>canonicalJSON(m.ref)===canonicalJSON(ref)))throw new Error("Tool is not imported by this profile")
  const store=new NodeFsVaultStorage(extensionObjectPath(ctx,ref.digest))
  const raw=await store.read("snapshot.json")
  if(!raw)throw new Error("Missing package snapshot")
  const tool=ImportedSnapshotSchema.parse(JSON.parse(raw)).tool
  if(snapshotDigest(tool)!==ref.digest || canonicalJSON(tool.manifest.ref)!==canonicalJSON(ref))throw new Error("Package snapshot integrity mismatch")
  return tool
}
async function readState(ctx:WorkflowContext,ref:ToolRef){
  const storage=await importStorage(ctx),path=statePath(ref)
  if(await storage.hasSymlinkTraversal(path))throw new Error("Environment alias")
  const raw=await storage.read(path)
  if(!raw)return null
  const record=EnvironmentRecordSchema.parse(JSON.parse(raw))
  if(record.profileId!==ctx.profileId || record.vaultId!==ctx.vaultId || canonicalJSON(record.tool)!==canonicalJSON(ref))throw new Error("Environment owner mismatch")
  return record
}
const stageRoot=(ctx:WorkflowContext,id:string)=>join(profileRuntimePath(ctx),"commands","setup",id,"output")
/** Hash installed content and links, excluding no mutable executable files. Links
 * must remain in this environment; hard links and special files fail closed. */
async function contentDigest(root:string):Promise<string>{
  const rows:string[]=[];let bytes=0
  const walk=async(path:string):Promise<void>=>{
    const info=await lstat(path),rel=relative(root,path)
    if(info.isSymbolicLink()){
      const target=await realpath(path)
      if(target!==root && !target.startsWith(root+"/"))throw new Error("Environment link escapes managed root")
      rows.push(`${rel}:link:${await readlink(path)}`)
    }else if(info.isDirectory()){
      for(const entry of (await readdir(path)).sort())await walk(join(path,entry))
    }else if(info.isFile() && info.nlink===1){
      bytes+=info.size;if(bytes>1024*1024*1024 || rows.length>=100000)throw new Error("Managed environment exceeds limits")
      rows.push(`${rel}:${info.mode & 0o777}:${sha256(await readFile(path))}`)
    }else throw new Error("Unsupported environment file")
  }
  await walk(root);return digest(rows)
}
async function verifiedRecord(ctx:WorkflowContext,record:EnvironmentRecord){
  if(record.state!=="ready" || !record.contentDigest)throw new Error("Environment needs setup")
  const root=stageRoot(ctx,record.setupId)
  if(await realpath(root)!==root || await contentDigest(root)!==record.contentDigest)throw new Error("Prepared environment integrity mismatch")
  const {digest:stored,...rest}=record
  if(digest({...rest,digest:undefined})!==stored)throw new Error("Environment record integrity mismatch")
  return record
}
/** Setup ID and Task8 usage survive all known retries. An interrupted installing
 * state is unknown until explicit reconciliation; this module never resets it. */
export async function ensureToolEnvironment(ctx:WorkflowContext,ref:ToolRef,input:SetupRecipe):Promise<EnvironmentRecord>{
  const recipe=SetupRecipeSchema.parse(input),tool=await importedTool(ctx,ref)
  if(canonicalJSON(recipe)!==canonicalJSON(tool.requirements))throw new Error("Setup recipe differs from reviewed immutable package")
  const storage=await importStorage(ctx)
  return storage.exclusive(`environment-${digest(ref)}`,async()=>{
    const old=await readState(ctx,ref)
    if(old?.state==="ready")return verifiedRecord(ctx,old)
    if(old?.state==="needs-reconciliation" || old?.pendingDiscard)return old
    if(old?.state==="installing"){
      const ready=await storage.read(`environments/${old.id}/record.json`)
      if(ready){
        const published=EnvironmentRecordSchema.parse(JSON.parse(ready))
        if(published.id!==old.id || published.setupId!==old.setupId || published.profileId!==ctx.profileId || published.vaultId!==ctx.vaultId || canonicalJSON(published.tool)!==canonicalJSON(ref))throw new Error("Environment owner mismatch")
        await verifiedRecord(ctx,published);await storage.write(statePath(ref),JSON.stringify(published));return published
      }
    }
    if(old?.state==="installing"){
      const record={...old,state:"needs-reconciliation" as const,reason:"Interrupted setup has uncertain staging; reconcile before retry"}
      await storage.write(statePath(ref),JSON.stringify(record));return record
    }
    const pin=recipe.environment?resolveToolchainPin(recipe.environment.runtime):null
    let record:EnvironmentRecord={schemaVersion:1,id:old?.id??randomUUID(),setupId:old?.setupId??randomUUID(),profileId:ctx.profileId,vaultId:ctx.vaultId,tool:ref,
      recipeDigest:digest(recipe),toolchainDigest:digest(pin),lockDigest:recipe.environment?.lockDigest??sha256(""),digest:sha256(""),state:"needs-setup",executed:old?.executed??false,completedSteps:0,reason:""}
    const save=async(state:EnvironmentRecord["state"],reason="")=>{
      record={...record,state,reason};record.digest=digest({...record,digest:undefined})
      await storage.write(statePath(ref),JSON.stringify(EnvironmentRecordSchema.parse(record)))
      return record
    }
    if(!tool.reviewed || tool.hostUnsupported.length || recipe.unsupported.length || recipe.internalModelCalls || !pin || !recipe.environment)return save("unsupported","Review requirements or provide a supported managed recipe; internal model calls require a metered adapter")
    if(recipe.runtimes.some(runtime=>runtime!==recipe.environment!.runtime))return save("unsupported","A declared runtime has no managed resolver")
    const supportedCommands=recipe.environment.runtime==="node22"?["node","npm"]:["python","python3.12","pip"]
    if(recipe.commands.some(command=>!supportedCommands.includes(command.executable)))return save("unsupported","A reviewed setup executable has no managed resolver")
    const isolation=await probeSandbox()
    if(isolation.status!=="ready")return save(isolation.status,"Command isolation must pass before setup can execute")
    const stage=stageRoot(ctx,record.setupId)
    if(await storage.hasSymlinkTraversal(`commands/setup/${record.setupId}`))throw new Error("Setup staging alias")
    await mkdir(stage,{recursive:true,mode:0o700})
    if(old)await contentDigest(stage) // Refuse aliases before any host-side retry writes.
    const staged=new NodeFsVaultStorage(stage),object=new NodeFsVaultStorage(extensionObjectPath(ctx,ref.digest))
    // All dependency inputs come from the reviewed immutable snapshot, not caller paths.
    for(const file of tool.files){
      const path="files/"+file.path
      if(await object.hasSymlinkTraversal(path))throw new Error("Package file alias")
      const bytes=await object.readBinary(path)
      if(!bytes || bytes.length!==file.bytes || sha256(bytes)!==file.sha256)throw new Error("Package content integrity mismatch")
      await staged.writeBinary("project/"+file.path,bytes)
    }
    const lock=await staged.read("project/"+recipe.environment.lockFile)
    if(lock===null || sha256(lock)!==recipe.environment.lockDigest)throw new Error("Dependency lock digest mismatch")
    validateDependencyLock(recipe,lock)
    await storage.write(`environments/${record.id}/toolchain-pin.json`,JSON.stringify(pin))
    await save("installing")
    try{
      record.executed=true
      const runtime=await prepareToolchain(ctx,record.setupId,pin,stage,ref.digest)
      await installDependencies(ctx,record,recipe,runtime,stage)
      const installedLock=await staged.read("project/"+recipe.environment.lockFile)
      if(installedLock===null || sha256(installedLock)!==record.lockDigest)throw new SetupInterruptedError(false)
      record.completedSteps=recipe.commands.length+1
      record.contentDigest=await contentDigest(stage)
      record={...record,state:"ready",reason:""};record.digest=digest({...record,digest:undefined})
      // Publish immutable ready record before its current-selection pointer.
      await storage.write(`environments/${record.id}/record.json`,JSON.stringify(record))
      await save("ready")
      return record
    }catch(error){
      if(error instanceof ToolchainNeedsSetupError){record.executed=old?.executed??false;return save("needs-setup",error.message)}
      if(error instanceof SetupInterruptedError)return save(error.uncertain?"needs-reconciliation":"interrupted",error.message)
      // Errors after dispatch may hide unknown completion; require explicit reconciliation.
      return save("needs-reconciliation","Setup could not be completed; reconcile staged files and Task8 journal before retry")
    }
  })
}
export function validateDependencyLock(recipe:SetupRecipe,lock:string){
  if(recipe.environment?.runtime==="node22"){
    if(recipe.environment.lockFile!=="package-lock.json")throw new Error("Node requires package-lock.json")
    const parsed=JSON.parse(lock)
    if(![2,3].includes(parsed.lockfileVersion) || !parsed.packages || typeof parsed.packages!=="object")throw new Error("Node requires an exact package lock")
    for(const [path,row] of Object.entries(parsed.packages)){
      if(!path)continue
      const dep=row as {resolved?:string;integrity?:string;link?:boolean}
      if(dep.link || typeof dep.resolved!=="string" || !dep.resolved.startsWith("https://registry.npmjs.org/") || !/^sha512-[A-Za-z0-9+/]+=*$/.test(dep.integrity??""))throw new Error("Node lock requires registry tarballs with SHA512 integrity")
    }
  }else{
    const lines=lock.replace(/\\\r?\n/g," ").split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#"))
    if(lines.some(l=>!/^[A-Za-z0-9_.-]+==[A-Za-z0-9_.+!-]+(?:\s+--hash=sha256:[a-f0-9]{64})+$/.test(l)))throw new Error("Python dependencies require exact versions and SHA256 hashes")
  }
}
async function installDependencies(ctx:WorkflowContext,record:EnvironmentRecord,recipe:SetupRecipe,runtime:PreparedToolchain,stage:string){
  const domains=recipe.environment!.runtime==="node22"?["registry.npmjs.org"]:["pypi.org","files.pythonhosted.org"]
  if(recipe.commands.some(c=>c.network.some(d=>!domains.includes(d))))throw new Error("Setup network must use approved package registries")
  let scope=await createCommandContext(ctx,{kind:"setup",id:record.setupId,packageDigest:record.tool.digest,executablePaths:runtime.executablePaths,runtimeReadRoots:runtime.runtimeReadRoots,registryDomains:domains})
  const invoke=async(executableId:string,argv:string[])=>{
    const result=await runIsolatedCommand(scope,record.setupId,{id:randomUUID(),executableId,argv,cwd:"project",resourceIds:[],connectionIds:[]},new AbortController().signal)
    if(result.uncertain || result.exitCode!==0 || result.termination!=="exited")throw new SetupInterruptedError(result.uncertain)
  }
  if(recipe.environment!.runtime==="node22")await invoke("node",[join(runtime.root,"lib/node_modules/npm/bin/npm-cli.js"),"ci","--ignore-scripts","--no-audit","--no-fund","--registry=https://registry.npmjs.org"])
  else{
    await invoke("python",["-I","-m","venv","--copies",join(stage,"venv")])
    // Use the managed interpreter to execute venv pip. Never inspect a user Python environment.
    await invoke("python",["-I","-m","pip","--python",join(stage,"venv/bin/python"),"--isolated","install","--require-hashes","--only-binary=:all:","--no-input","--disable-pip-version-check","-r",recipe.environment!.lockFile])
    // Reviewed helpers must see the dependencies just installed into the venv.
    // Retain the setup identity so Task8 continues the same accounting journal.
    scope=await createCommandContext(ctx,{kind:"setup",id:record.setupId,packageDigest:record.tool.digest,
      executablePaths:{python:join(stage,"venv/bin/python")},runtimeReadRoots:[...runtime.runtimeReadRoots,join(stage,"venv")],registryDomains:domains})
  }
  for(const step of recipe.commands){
    if(step.executable==="npm")await invoke("node",[join(runtime.root,"lib/node_modules/npm/bin/npm-cli.js"),...step.argv])
    else if(step.executable==="pip")await invoke("python",["-I","-m","pip","--isolated",...step.argv])
    else await invoke(step.executable==="python3.12"?"python":step.executable,step.argv)
  }
}
export async function resolvePreparedEnvironmentRefs(ctx:WorkflowContext,tools:ToolRef[],model?:RunModel):Promise<PreparedEnvironmentRef[]>{
  const refs:PreparedEnvironmentRef[]=[]
  for(const ref of tools){const native=getToolManifest(ref);if(native?.kind==="native" && model && !native.engines.includes(model.engine))throw new Error("Required provider/model change needs explicit selection")}
  const needed=tools.filter(ref=>getToolManifest(ref)?.kind!=="native")
  if(!needed.length)return refs
  const imported=await readImportedManifests(ctx)
  for(const ref of needed){
    if(!imported.some(m=>canonicalJSON(m.ref)===canonicalJSON(ref)))continue // Native/no-environment tools.
    const tool=await importedTool(ctx,ref)
    if(model && (!tool.manifest.engines.includes(model.engine) || tool.requirements.requiredModels?.some(m=>!Object.values(model.tierModels).some(t=>t.model===m))))throw new Error("Required provider/model change needs explicit selection")
    if(!tool.reviewed || tool.hostUnsupported.length || tool.requirements.unsupported.length || tool.requirements.internalModelCalls)throw new Error("Tool requirements remain unsupported")
    if(!tool.requirements.environment){if(tool.manifest.kind==="command" || tool.requirements.commands.length || tool.requirements.runtimes.length)throw new Error("Tool environment needs setup");continue}
    const record=await readState(ctx,ref)
    if(!record)throw new Error("Tool environment needs setup")
    await verifiedRecord(ctx,record)
    refs.push({id:record.id,digest:record.digest,lockDigest:record.lockDigest})
  }
  if(refs.length && (await probeSandbox()).status!=="ready")throw new Error("Tool environment isolation needs setup")
  return refs
}
export async function checkToolReadiness(ctx:WorkflowContext,ref:ToolRef):Promise<CompatibilityReport>{
  const tool=await importedTool(ctx,ref)
  const model=await resolveRunModel(ctx,ref)
  if(!tool.manifest.engines.includes(model.engine) || tool.requirements.requiredModels?.some(m=>!Object.values(model.tierModels).some(t=>t.model===m)))return {status:"needs-setup",reasons:["Required provider/model change needs explicit selection"]}
  if(!tool.reviewed)return {status:"needs-review",reasons:["Review the imported tool"]}
  if(tool.hostUnsupported.length || tool.requirements.unsupported.length || tool.requirements.internalModelCalls)return {status:"unsupported",reasons:[...tool.hostUnsupported,...tool.requirements.unsupported,...(tool.requirements.internalModelCalls?["Internal model calls require a metered adapter"]:[])]}
  if(tool.manifest.connections.length){
    if(tool.requirements.connectionAdapter!=="scispark-http-v1" || tool.manifest.connections.some(c=>c!=="semantic-scholar"))return {status:"unsupported",reasons:["Required service adapter is unavailable"]}
    const refs=await connectionRefsForTools(ctx,[ref])
    const bindings=await Promise.all(refs.map(r=>readConnectionRevision(ctx,r)))
    if(!bindings.some(b=>b.service==="semantic-scholar") || !await getServerS2Key(ctx.storage))return {status:"needs-setup",reasons:["Bind Semantic Scholar and configure its credential"]}
  }
  const state=await readState(ctx,ref)
  if(tool.requirements.environment || tool.manifest.kind==="command" || tool.requirements.commands.length || tool.requirements.runtimes.length){
    if(!state || state.state!=="ready")return {status:state?.state==="unsupported"?"unsupported":"needs-setup",reasons:[state?.reason||"Prepare a managed environment"]}
    try{await verifiedRecord(ctx,state)}catch{return {status:"needs-setup",reasons:["Prepared environment integrity needs repair"]}}
    const isolation=await probeSandbox()
    if(isolation.status!=="ready")return {status:isolation.status,reasons:["Command isolation is unavailable"]}
  }
  return {status:"ready",reasons:[]}
}

/** Full immutable candidate closure: setup must complete for every declared choice
 * before starting a research run. Task10 selects only among these captured refs. */
export async function resolveToolPreparationClosure(ctx:WorkflowContext,root:ToolRef){
  let imported:Awaited<ReturnType<typeof readImportedManifests>>|undefined
  const visited=new Set<string>(),visiting=new Set<string>(),dependencies:ToolRef[]=[]
  const manifestFor=async(ref:ToolRef)=>{
    const registered=getToolManifest(ref)
    if(registered?.kind==="native")return registered
    imported??=await readImportedManifests(ctx)
    return imported.find(m=>canonicalJSON(m.ref)===canonicalJSON(ref))??registered
  }
  const manifest=await manifestFor(root)
  if(!manifest)throw new Error("Pinned tool version is unavailable")
  const visit=async(ref:ToolRef):Promise<void>=>{
    const identity=canonicalJSON(ref)
    if(visiting.has(identity))throw new Error("Tool dependency cycle")
    if(visited.has(identity))return
    const node=await manifestFor(ref)
    if(!node)throw new Error("Pinned dependency version is unavailable")
    visiting.add(identity)
    const candidates=imported?.some(m=>canonicalJSON(m.ref)===identity)?(await importedTool(ctx,ref)).proposal.dependencySlots.flatMap(slot=>slot.eligible):[]
    for(const dependency of [...node.dependencies,...candidates])await visit(dependency)
    visiting.delete(identity);visited.add(identity)
    if(identity!==canonicalJSON(root))dependencies.push(ref)
  }
  await visit(root);return {manifest,dependencies}
}
/** Recovery uses only immutable captured IDs, never the mutable current binding. */
export async function validateCapturedPreparation(ctx:WorkflowContext,run:ToolRun){
  if(!run.preparedEnvironmentRefs.length && !run.connectionConfigurationRefs.length)return
  if(run.preparedEnvironmentRefs.length && (await probeSandbox()).status!=="ready")throw new Error("Captured command isolation is unavailable")
  const storage=await importStorage(ctx)
  for(const ref of run.preparedEnvironmentRefs){
    const path=`environments/${ref.id}/record.json`
    if(await storage.hasSymlinkTraversal(path))throw new Error("Environment alias")
    const raw=await storage.read(path)
    if(!raw)throw new Error("Captured environment is unavailable")
    const record=EnvironmentRecordSchema.parse(JSON.parse(raw))
    if(record.id!==ref.id || record.digest!==ref.digest || record.lockDigest!==ref.lockDigest || record.profileId!==ctx.profileId || record.vaultId!==ctx.vaultId || ![run.tool,...run.dependencies].some(t=>canonicalJSON(t)===canonicalJSON(record.tool)))throw new Error("Captured environment mismatch")
    await verifiedRecord(ctx,record)
  }
  for(const ref of run.connectionConfigurationRefs)await readConnectionRevision(ctx,ref)
  if(run.connectionConfigurationRefs.length && !await getServerS2Key(ctx.storage))throw new Error("Captured source credential needs setup")
}

/** Task10 host factory input derived solely from a captured prepared environment. */
export async function resolveCapturedToolEnvironment(ctx:WorkflowContext,run:ToolRun,tool:ToolRef){
  await validateCapturedPreparation(ctx,run)
  const storage=await importStorage(ctx)
  for(const ref of run.preparedEnvironmentRefs){
    const raw=await storage.read(`environments/${ref.id}/record.json`)
    const record=EnvironmentRecordSchema.parse(JSON.parse(raw!))
    if(canonicalJSON(record.tool)!==canonicalJSON(tool))continue
    const stage=stageRoot(ctx,record.setupId),pinPath=`environments/${record.id}/toolchain-pin.json`
    if(await storage.hasSymlinkTraversal(pinPath))throw new Error("Captured toolchain pin alias")
    const retained=await storage.read(pinPath)
    if(!retained)throw new Error("Captured toolchain pin is unavailable")
    const pin=ToolchainPinSchema.parse(JSON.parse(retained))
    if(digest(pin)!==record.toolchainDigest)throw new Error("Captured toolchain pin integrity mismatch")
    if(pin.platform!==process.platform || pin.arch!==process.arch)throw new Error("Captured toolchain platform mismatch")
    const executablePaths=pin.runtime==="node22"?{node:join(stage,"runtime/bin/node")}:{python:join(stage,"venv/bin/python")}
    const systemRoots:string[]=[]
    for(const path of ["/bin","/usr/bin","/usr/lib","/lib","/lib64"]){try{systemRoots.push(await realpath(/* turbopackIgnore: true */ path))}catch{}}
    return {projectRoot:join(stage,"project"),executablePaths,runtimeReadRoots:[...new Set([...systemRoots,stage])]}
  }
  throw new Error("No captured environment for this tool")
}

/** Explicit host operation only; never called by readiness or automatic recovery.
 * Consumers must present a user-authorized discard with the displayed setup ID. */
export async function acknowledgeAndDiscardToolSetup(ctx:WorkflowContext,ref:ToolRef,setupId:string,operationId:string):Promise<EnvironmentRecord>{
  UuidSchema.parse(setupId);UuidSchema.parse(operationId);await importedTool(ctx,ref)
  const storage=await importStorage(ctx)
  return storage.exclusive(`environment-${digest(ref)}`,async()=>{
    const record=await readState(ctx,ref)
    if(!record || record.setupId!==setupId)throw new Error("Setup discard owner mismatch")
    const receipt=`setup-discards/${setupId}/${operationId}.json`
    if(await storage.read(receipt) && record.pendingDiscard!==operationId)return record
    if(!["installing","needs-reconciliation"].includes(record.state))throw new Error("Setup does not need reconciliation")
    if((await probeSandbox()).status!=="ready")throw new Error("Restore process containment before discarding uncertain staging")
    const path=`commands/setup/${setupId}`
    if(await storage.hasSymlinkTraversal(path))throw new Error("Setup staging alias")
    if(record.pendingDiscard && record.pendingDiscard!==operationId)throw new Error("Another explicit discard is pending")
    record.pendingDiscard=operationId
    await storage.write(statePath(ref),JSON.stringify(record))
    await reconcileSetupAfterDiscard(ctx,setupId,operationId,async()=>{
      for(const child of ["output","tmp"])await rm(join(profileRuntimePath(ctx),path,child),{recursive:true,force:true})
    })
    const updated={...record,pendingDiscard:undefined,state:"interrupted" as const,completedSteps:0,reason:"Owned staging explicitly discarded; cumulative usage retained"}
    updated.digest=digest({...updated,digest:undefined})
    await storage.write(statePath(ref),JSON.stringify(updated))
    return updated
  })
}

export async function resolveToolConnectionRefs(ctx:WorkflowContext,tools:ToolRef[]):Promise<ConnectionConfigurationRef[]>{
  const needed=tools.filter(ref=>getToolManifest(ref)?.connections.length!==0)
  if(!needed.length)return []
  const refs=await connectionRefsForTools(ctx,needed)
  for(const ref of needed){
    const tool=await importedTool(ctx,ref)
    if(!tool.manifest.connections.length)continue
    if(tool.requirements.connectionAdapter!=="scispark-http-v1" || tool.manifest.connections.some(service=>service!=="semantic-scholar"))throw new Error("Required service adapter is unsupported")
    const selected=await connectionRefsForTools(ctx,[ref])
    if(!selected.length || !await getServerS2Key(ctx.storage))throw new Error("Required source connection needs setup")
    for(const revision of selected)await readConnectionRevision(ctx,revision)
  }
  return refs
}
