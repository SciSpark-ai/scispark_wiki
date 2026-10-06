// @vitest-environment node
import {afterEach, expect, it} from "vitest"
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises"
import {join} from "node:path"
import {tmpdir} from "node:os"
import {randomUUID} from "node:crypto"
import {NodeFsVaultStorage} from "../../vault/node-fs-storage"
import {acquirePackage} from "../acquire"
import {inspectPackage,validateInputSchema} from "../inspect"
import {toolRunInput} from "../intent"
import {openciteCatalogEntry} from "../catalog/opencite"
import {literatureReviewCatalogGraph} from "../catalog/literature-review"
const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})))})
const input={question:"Speech development",sessionId:"chat_fixture",operationId:randomUUID(),contextRefs:[],sources:["s2" as const]}
it("binds a plain SKILL's actual inferred schema to the human question only",async()=>{
 const root=await mkdtemp(join(tmpdir(),"binding-"));roots.push(root)
 const vaultPath=join(root,"vault"),source=join(root,"source");await mkdir(vaultPath);await mkdir(source)
 await writeFile(join(source,"SKILL.md"),"---\nname: Plain research\ndescription: Analyze the request\n---\nUse the supplied research.")
 const ctx={profileId:randomUUID(),vaultId:"a".repeat(64),vaultPath,runtimeRoot:join(root,"runtime"),storage:new NodeFsVaultStorage(vaultPath)}
 await mkdir(ctx.runtimeRoot)
 const preview=await inspectPackage(ctx,await acquirePackage(ctx,{kind:"local-folder",path:source})),manifest=preview.tools[0].manifest
 const args=toolRunInput(input,manifest.ref,manifest)
 expect(args).toEqual({question:input.question})
 expect(validateInputSchema(manifest.inputSchema).safeParse(args).success).toBe(true)
 expect(manifest.engines).toEqual(["api","codex","claude-code"])
})
it("binds both actual catalog contracts without session/source arguments",()=>{
 const literature=literatureReviewCatalogGraph().root.manifest
 expect(toolRunInput(input,literature.ref,literature)).toEqual({question:input.question})
 const entry=openciteCatalogEntry(), manifest={...literature,...entry.proposal,ref:{packageId:"neuromechanist.opencite",skillId:"SKILL.md",version:entry.version,digest:"a".repeat(64)}}
 const args=toolRunInput(input,manifest.ref,manifest)
 expect(args).toEqual({query:input.question,limit:10,fullText:false})
 expect(validateInputSchema(manifest.inputSchema).safeParse(args).success).toBe(true)
})
it("rejects ambiguous or incompatible schemas without discarding the human request",()=>{
 const manifest=literatureReviewCatalogGraph().root.manifest
 for(const inputSchema of [{type:"object",additionalProperties:false},{type:"object",properties:{query:{type:"string"}},required:["query"]},{type:"object",properties:{question:{type:"string"},other:{type:"string"}},required:["question","other"]}]) {
  expect(()=>toolRunInput(input,manifest.ref,{...manifest,inputSchema})).toThrow(/input|question|binding/i)
 }
})
