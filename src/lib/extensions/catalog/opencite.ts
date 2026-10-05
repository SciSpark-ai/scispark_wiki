import { z } from "zod"
import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { CatalogEntrySchema, OpenCiteResultSchema, OpenCiteSourceReferenceSchema, StagedPackageSchema, type CatalogEntry, type OpenCiteResult } from "../import-contract"
import type { WorkflowContext } from "../../workflows/context"
import type { ToolRef } from "../contracts"
import lock from "./opencite.lock.json"

export const OPENCITE_ENTRYPOINT = "scispark-opencite-v1.py"
export const OpenCiteInputSchema = z.object({query:z.string().min(1).max(1000).refine(s=>!s.includes("\0")),limit:z.number().int().min(1).max(20).default(10),fullText:z.boolean().default(false)}).strict()
export function openciteCatalogEntry(): CatalogEntry {
  return CatalogEntrySchema.parse({id:"opencite",name:"OpenCite",version:"0.5.4-scispark.1",source:{kind:"github",url:"https://github.com/neuromechanist/research-skills",ref:lock.researchSkillsRevision,packageId:"neuromechanist.opencite"},bundleDigest:lock.bundleDigest,
    notices:["opencite-LICENSE","research-skills-LICENSE"],requiredConnections:["semantic-scholar"],expectedCapabilities:["paper-search","public-full-text","bibtex"],
    proposal:{skillId:"SKILL.md",name:"OpenCite",description:"Semantic Scholar search, observed public PDFs, local Markdown conversion and BibTeX. Other OpenCite sources/commands are not exposed.",kind:"command",entrypoint:OPENCITE_ENTRYPOINT,capabilities:["paper-search","public-full-text","bibtex"],resources:lock.files.map(f=>f.path),dependencies:[],dependencySlots:[],connections:["semantic-scholar"],engines:["api","codex","claude-code"],
      executionCommands:[{id:"search",executableId:"python",entrypoint:OPENCITE_ENTRYPOINT,argv:[]}],inputSchema:{type:"object",properties:{query:{type:"string",minLength:1,maxLength:1000},limit:{type:"integer",minimum:1,maximum:20},fullText:{type:"boolean"}},required:["query"],additionalProperties:false},outputKinds:["papers","bibtex","file","markdown"],
      setup:{commands:[],runtimes:["python3.12"],unsupported:[],environment:{runtime:"python3.12",lockFile:"requirements.lock",lockDigest:lock.requirementsSha256},connectionAdapter:"scispark-http-v1",internalModelCalls:false}}})
}
/** Stage the pinned bundled source plus reviewed overlay only after catalog selection.
 * Normal inspect -> review -> commitImport is still required; nothing is enabled. */
export async function stageOpenCiteCatalogEntry(ctx:WorkflowContext) {
  const { importStorage } = await import("../store")
  const storage = await importStorage(ctx), id = randomUUID(), entry = openciteCatalogEntry()
  for(const file of lock.files) {
    const bytes=await readFile(join(process.cwd(),"src/lib/extensions/catalog/opencite",file.path))
    if(bytes.length!==file.bytes || createHash("sha256").update(bytes).digest("hex")!==file.sha256) throw new Error("Catalog bundle integrity mismatch")
    await storage.writeBinary(`imports/${id}/files/${file.path}`,bytes)
  }
  const stage=StagedPackageSchema.parse({schemaVersion:1,id,profileId:ctx.profileId,vaultId:ctx.vaultId,packageId:"neuromechanist.opencite",version:entry.version,provenance:{source:"github",locator:"https://github.com/neuromechanist/research-skills",revision:lock.researchSkillsRevision},files:lock.files})
  await storage.write(`imports/${id}/stage.json`,JSON.stringify(stage))
  return stage
}
export async function openCiteReadiness(ctx:WorkflowContext,ref:ToolRef) {
  return (await import("../setup")).checkToolReadiness(ctx,ref)
}
const short=z.string().max(2000)
const sourceUrl=OpenCiteSourceReferenceSchema
const paperSchema=z.object({title:z.string().min(1).max(2000),authors:z.array(z.object({name:short,family_name:short,given_name:short}).strict()).max(50),year:z.number().int().min(1000).max(9999).nullable(),ids:z.object({doi:short,pmid:short,pmcid:short,openalex_id:short,s2_id:short,arxiv_id:short}).strict(),citation_count:z.number().nonnegative(),url:z.union([sourceUrl,z.literal("")]),is_oa:z.boolean(),oa_status:short,data_sources:z.array(z.literal("s2")).max(1),abstract:z.string().max(16000).optional(),tldr:short.optional(),topics:z.array(short).optional(),mesh_terms:z.array(short).optional(),journal:short.optional(),publication_date:short.optional(),pub_type:short.optional(),is_retracted:z.boolean().optional(),grants:z.array(z.unknown()).max(100).optional(),pdf_locations:z.array(z.object({url:sourceUrl,source:z.literal("s2"),is_oa:z.boolean(),version:short,license:short}).strict()).max(10).optional()}).strict()
const envelope=z.object({schemaVersion:z.literal(1),packageVersion:z.literal("0.5.4"),sourceStatus:z.enum(["ok","rate-limited","unavailable"]),papers:z.array(paperSchema).max(20),bibtex:z.string().max(100000),documents:z.array(z.object({paperIndex:z.number().int().min(0).max(19),url:sourceUrl,status:z.enum(["ok","unavailable"]),pdfBase64:z.string().max(699052).optional(),markdown:z.string().max(32000).optional()}).strict()).max(2)}).strict()
export function normalizeOpenCiteOutput(value:unknown):OpenCiteResult {
  const parsed=envelope.parse(value)
  if(parsed.sourceStatus!=="ok" && (parsed.papers.length||parsed.bibtex||parsed.documents.length))throw new Error("Failed source cannot produce successful artifacts")
  const papers=parsed.papers.map(p=>({title:p.title,doi:p.ids.doi,url:p.url,authors:p.authors.map(a=>a.name),year:p.year,abstract:p.abstract??"",access:"abstract" as "abstract"|"full-text",sourceRefs:[...(p.ids.doi?[`doi:${p.ids.doi}`]:[]),...(p.url?[p.url]:[]),...(p.pdf_locations??[]).map(l=>l.url)]}))
  const sourceRefs=[...new Set(papers.flatMap(p=>p.sourceRefs))]
  const documents:OpenCiteResult["artifacts"]=[]
  const seen=new Set<number>()
  for(const document of parsed.documents){
    if(seen.has(document.paperIndex))throw new Error("Duplicate paper document")
    seen.add(document.paperIndex)
    const paper=papers[document.paperIndex]
    if(!paper || !parsed.papers[document.paperIndex].pdf_locations?.some(l=>l.url===document.url))throw new Error("Document was not observed in source records")
    if(document.status!=="ok") {if(document.pdfBase64||document.markdown)throw new Error("Unavailable document contains content");continue}
    if(new URL(document.url).protocol!=="https:")throw new Error("HTTP source references cannot claim retrieved document content")
    const bytes=Buffer.from(document.pdfBase64??"","base64")
    if(bytes.length>524288 || !bytes.subarray(0,5).equals(Buffer.from("%PDF-")) || bytes.toString("base64")!==document.pdfBase64)throw new Error("Invalid bounded PDF")
    paper.access="full-text"
    documents.push({kind:"file",title:`PDF: ${paper.title}`.slice(0,500),mediaType:"application/pdf",sourceRefs:paper.sourceRefs,base64:document.pdfBase64})
    if(document.markdown)documents.push({kind:"markdown",title:`Full text: ${paper.title}`.slice(0,500),mediaType:"text/markdown",sourceRefs:paper.sourceRefs,text:document.markdown})
  }
  return OpenCiteResultSchema.parse({sourceStatus:parsed.sourceStatus==="ok"&&!papers.length?"no-results":parsed.sourceStatus,papers,artifacts:[{kind:"papers",title:"OpenCite papers",mediaType:"application/json",sourceRefs,text:JSON.stringify(papers)},...(parsed.bibtex?[{kind:"bibtex",title:"OpenCite citations",mediaType:"application/x-bibtex",sourceRefs,text:parsed.bibtex}]:[]),...documents]})
}
