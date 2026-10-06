// @vitest-environment node
// Production routing with actual inferred/catalog contracts; only availability,
// classifier, retained lookup and dispatch are offline fixtures. No paid calls.
import {afterEach,expect,it,vi} from "vitest"
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {NodeFsVaultStorage} from "../../vault/node-fs-storage"
import {acquirePackage} from "../acquire"
import {inspectPackage} from "../inspect"
import {randomUUID} from "node:crypto"
import {workflowFixture} from "../../workflows/__tests__/fixtures"
import {askChat} from "../../chat/orchestrator"
import {chooseTool} from "../choice-store"
import {validateInputSchema} from "../inspect"
import * as retained from "../store"
import * as library from "../library"
import * as classifier from "../classification-attempt"
import * as coordinator from "../../workflows/coordinator"
import {literatureReviewCatalogGraph} from "../catalog/literature-review"
import {NATIVE_TOOL_MANIFESTS} from "../native-catalog"
const roots:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
it.each(["direct","named","chooser"])("binds plain SKILL and both curated contracts through the real %s public start",async(path)=>{
 const graph=literatureReviewCatalogGraph()
 const base=await mkdtemp(join(tmpdir(),"public-binding-"));roots.push(base)
 const {ctx:plainCtx}=workflowFixture();plainCtx.vaultPath=join(base,"vault");plainCtx.runtimeRoot=join(base,"runtime");plainCtx.storage=new NodeFsVaultStorage(plainCtx.vaultPath)
 const source=join(base,"source");await Promise.all([source,plainCtx.vaultPath,plainCtx.runtimeRoot].map(p=>mkdir(p)))
 await writeFile(join(source,"SKILL.md"),"---\nname: Plain request\n---\nAnalyze supplied evidence")
 const plain=(await inspectPackage(plainCtx,await acquirePackage(plainCtx,{kind:"local-folder",path:source}))).tools[0]
 for(const imported of [plain,graph.root,graph.opencite]){
  const {ctx,run}=workflowFixture(),manifest=imported.manifest, alternative=NATIVE_TOOL_MANIFESTS[0]
  const tools=[manifest,alternative].map(m=>({...m,enabled:true,installed:true,pinned:false,readiness:{status:"ready" as const,reasons:[]},connectionRequirements:[]}))
  vi.spyOn(library,"listToolLibrary").mockResolvedValue({tools,catalog:[],discoveryDismissed:false})
  vi.spyOn(retained,"readImportedTool").mockResolvedValue(imported)
  vi.spyOn(classifier,"classifyToolIntent").mockResolvedValue({kind:"tools",toolIds:[0,1]})
  const start=vi.spyOn(coordinator,"startRun").mockImplementation(async(_ctx,input)=>{
   expect(validateInputSchema(manifest.inputSchema).safeParse(input.input).success).toBe(true)
   expect(input.input).not.toHaveProperty("sessionId");expect(input.input).not.toHaveProperty("sources")
   expect(input.sessionId).toMatch(/^chat_/)
   return {...run,...input,id:randomUUID(),allowance:run.allowance}
  })
  const question=path==="named"?`Use ${manifest.name} to review speech`:"Review speech"
  const result=await askChat(ctx.storage,{workflowContext:ctx,input:{sessionId:null,question,readSourcesOnly:false,operationId:randomUUID(),...(path==="direct"?{explicitTool:manifest.ref}:{})}})
  if(path==="chooser"){
   const choice=result.message.blocks?.find(b=>b.type==="tool-choice")
   if(choice?.type!=="tool-choice")throw Error("Choice missing")
   expect(start).not.toHaveBeenCalled()
   await chooseTool(ctx,choice.choice.id,manifest.ref,randomUUID())
  }
  expect(start).toHaveBeenCalledTimes(1)
  expect(start.mock.calls[0][1].input).toEqual(imported===graph.opencite?{query:question,limit:10,fullText:false}:{question})
  vi.restoreAllMocks()
 }
})
