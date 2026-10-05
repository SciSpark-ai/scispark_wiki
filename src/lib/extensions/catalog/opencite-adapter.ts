import { join } from "node:path"
import { canonicalJSON } from "../store"
import { exactRef } from "../dependencies"
import { readInstructionTool, hostStepId } from "../../workflows/host-tools"
import { resolveCapturedToolEnvironment } from "../setup"
import { capturedOpenCiteConnections } from "../connections"
import { createConnectionBroker } from "../network-broker"
import { createCommandContext, runIsolatedCommand } from "../sandbox"
import { HelperInvocationSchema, HelperResultSchema, type WorkflowAdapter, type WorkflowIO, type HelperInvocation } from "../../workflows/adapters"
import type { WorkflowContext } from "../../workflows/context"
import type { ToolRun } from "../../workflows/contracts"
import { workflowHash } from "../../workflows/journal"
import { normalizeOpenCiteOutput, OpenCiteInputSchema, openciteCatalogEntry } from "./opencite"
import lock from "./opencite.lock.json"

async function execute(ctx:WorkflowContext, root:ToolRun, candidate:HelperInvocation, io:WorkflowIO) {
  const invocation=HelperInvocationSchema.parse(candidate), input=OpenCiteInputSchema.parse(invocation.input)
  if(![root.tool,...root.dependencies].some(ref=>exactRef(ref)===exactRef(invocation.tool)))throw new Error("OpenCite helper is outside captured root")
  const {tool}=await readInstructionTool(ctx,invocation.tool), entry=openciteCatalogEntry()
  if(tool.manifest.ref.packageId!=="neuromechanist.opencite" || tool.manifest.ref.version!==entry.version || tool.manifest.provenance.revision!==lock.researchSkillsRevision || canonicalJSON(tool.proposal)!==canonicalJSON(entry.proposal) || canonicalJSON(tool.files)!==canonicalJSON(lock.files)) throw new Error("OpenCite adapter requires the exact reviewed bundle and recipe")
  const id=hostStepId({id:invocation.frameId,tool:invocation.tool,input,turn:0,observations:[],publicText:""},"opencite-command")
  const result=await io.step({id,kind:"command",replay:"reconcile",inputHash:workflowHash(canonicalJSON({tool:invocation.tool,input}))},async()=>{
    const prepared=await resolveCapturedToolEnvironment(ctx,root,invocation.tool)
    const {bindings}=await capturedOpenCiteConnections(ctx,root.connectionConfigurationRefs)
    const broker=await createConnectionBroker(ctx,root.id,bindings,{publicDocuments:input.fullText})
    try {
      const command=tool.proposal.executionCommands![0]
      const context=await createCommandContext(ctx,{kind:"run",id:root.id,packageDigest:invocation.tool.digest,executablePaths:Object.fromEntries(Object.entries(prepared.executablePaths).filter((entry):entry is [string,string]=>typeof entry[1]==="string")),runtimeReadRoots:prepared.runtimeReadRoots,resourceIds:[],connectionIds:bindings.map(b=>b.id)},broker)
      // Only this reviewed binding becomes argv. Task8 alone reserves/settles usage.
      const commandResult=await runIsolatedCommand(context,root.id,{id,executableId:"python",argv:["-I",join(prepared.projectRoot,command.entrypoint),JSON.stringify(input)],cwd:".",resourceIds:[],connectionIds:bindings.map(b=>b.id)},io.signal)
      if(commandResult.uncertain || commandResult.termination!=="exited" || commandResult.exitCode!==0)throw new Error("OpenCite command unavailable or interrupted; reconcile before retry")
      return normalizeOpenCiteOutput(JSON.parse(commandResult.stdout))
    } finally {await broker.close()}
  })
  const artifactIds:string[]=[]
  for(const artifact of result.artifacts){
    const published=await io.publishArtifact({kind:artifact.kind,title:artifact.title,mediaType:artifact.mediaType,sourceRefs:artifact.sourceRefs,bytes:Buffer.from(artifact.base64??artifact.text??"",artifact.base64?"base64":"utf8")})
    artifactIds.push(published.id)
  }
  return HelperResultSchema.parse({summary:result.sourceStatus==="ok"?`OpenCite found ${result.papers.length} papers.`:`OpenCite source status: ${result.sourceStatus}.`,artifactIds})
}
export const openCiteWorkflowAdapter:WorkflowAdapter={
  execute:async(ctx,root,io)=>{const result=await execute(ctx,root,{frameId:root.id,tool:root.tool,input:root.input},io);await io.emit({type:"text",text:result.summary})},
  executeHelper:execute,
}
