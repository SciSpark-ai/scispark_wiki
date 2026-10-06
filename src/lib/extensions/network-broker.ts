import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { request } from "node:https"
import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { z } from "zod"
import type { WorkflowContext } from "../workflows/context"
import { readRun } from "../workflows/store"
import { getServerS2Key } from "../server/paper-source-settings"
import { readConnectionRevision, type CommandConnections } from "./connections"
import { canonicalJSON } from "./store"

// Pin the validated DNS address at connect time: no second resolution/rebinding.
const denied = new BlockList()
for (const [network,prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.168.0.0",16],["192.0.2.0",24],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) denied.addSubnet(network,prefix,"ipv4")
class DocumentSizeLimitError extends Error {}
/** Server-owned HTTPS destinations only. No redirect, ambient proxy, or response headers returned. */
export async function requestPublicHttps(url: URL, headers: Record<string,string>, maxBytes: number, signal: AbortSignal): Promise<{status:number;bytes:Buffer}> {
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) throw new Error("Invalid public destination")
  signal.throwIfAborted()
  const addresses = await new Promise<Array<{address:string;family:number}>>((resolve,reject)=>{
    const abort=()=>reject(new Error("Service request aborted"))
    signal.addEventListener("abort",abort,{once:true})
    lookup(url.hostname,{all:true,family:4}).then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort))
  })
  signal.throwIfAborted()
  if (!addresses.length || addresses.some(a=>isIP(a.address)!==4 || denied.check(a.address,"ipv4"))) throw new Error("Private destination refused")
  return new Promise((resolve,reject)=>{
    const fail = () => reject(new Error("Service request unavailable"))
    const req = request(url,{headers,signal,family:4,lookup:(_host,_options,cb)=>cb(null,addresses[0].address,4)},res=>{
      const chunks:Buffer[]=[]; let size=0
      res.on("data",(chunk:Buffer)=>{ size+=chunk.length; if(size>maxBytes) {reject(new DocumentSizeLimitError());res.destroy()} else chunks.push(chunk) })
      res.on("error",fail)
      res.on("end",()=>resolve({status:res.statusCode??502,bytes:Buffer.concat(chunks)}))
    })
    req.on("error",fail);req.end()
  })
}
export interface ConnectionBroker {
  readonly handles: ReadonlyArray<{connectionId:string; handle:string; origin:"http://semantic-scholar.scispark.invalid"}>
  close(): Promise<void>
}
interface Capability { ctx:WorkflowContext; runId:string; port:number; live:boolean; handles:ConnectionBroker["handles"] }
const capabilities = new WeakMap<ConnectionBroker,Capability>()
export function connectionBrokerCapability(ctx:WorkflowContext,runId:string,ids:string[],broker:ConnectionBroker) {
  const cap=capabilities.get(broker)
  if(!cap?.live || cap.ctx.profileId!==ctx.profileId || cap.ctx.vaultId!==ctx.vaultId || cap.ctx.runtimeRoot!==ctx.runtimeRoot || cap.runId!==runId || ids.some(id=>!cap.handles.some(h=>h.connectionId===id))) throw new Error("Invalid or closed scoped connection broker")
  return { port:cap.port, handles:cap.handles.filter(h=>ids.includes(h.connectionId)) }
}
const Query = z.object({ query:z.string().min(1).max(1000),limit:z.coerce.number().int().min(1).max(100).optional(),offset:z.coerce.number().int().min(0).max(10000).optional(),fields:z.string().max(1000).regex(/^[a-zA-Z.,]+$/).optional() }).strict()
/** Adapter protocol: GET absolute virtual URL, Proxy-Authorization: Bearer <handle>.
 * No generic forward proxy or CONNECT tunnel. Document GET additionally requires
 * a host-enabled, instance-local grant from successful source search records. */
export async function createConnectionBroker(ctx:WorkflowContext,runId:string,bindings:CommandConnections["bindings"], options: { publicDocuments?: boolean } = {}):Promise<ConnectionBroker> {
  const run=await readRun(ctx,runId)
  if(!run || run.status!=="running") throw new Error("Run is unavailable for connections")
  if(!bindings.length || new Set(bindings.map(b=>b.id)).size!==bindings.length) throw new Error("Invalid broker bindings")
  for(const binding of bindings){
    const ref=run.connectionConfigurationRefs.find(r=>r.id===binding.id && r.revision===binding.revision)
    if(!ref || canonicalJSON(await readConnectionRevision(ctx,ref))!==canonicalJSON(binding)) throw new Error("Connection is not captured by this run")
  }
  if(!await getServerS2Key(ctx.storage)) throw new Error("Semantic Scholar credentials need setup")
  const handles=Object.freeze(bindings.map(b=>Object.freeze({connectionId:b.id,handle:randomBytes(32).toString("hex"),origin:"http://semantic-scholar.scispark.invalid" as const})))
  // In-memory grants belong to this broker/run/profile and expire on close.
  // Restarted/sequential brokers must observe fresh source records, never caller URLs.
  const documents = new Set<string>()
  let requests = 0, documentRequests = 0
  const sourceRecords = z.object({data:z.array(z.object({title:z.string().min(1).max(2000),isOpenAccess:z.boolean().optional(),openAccessPdf:z.object({url:z.string().max(2048)}).passthrough().nullish()}).passthrough()).max(100)}).passthrough()
  const abort=new AbortController()
  const server=createServer({maxHeaderSize:8192},async(req,res)=>{
    const deny=(status=403)=>{res.writeHead(status,{"Content-Type":"text/plain"});res.end("Connection request refused")}
    try {
      const ownedRun=await readRun(ctx,runId)
      if(!ownedRun || ownedRun.status!=="running")return deny()
      const handle=req.headers["proxy-authorization"]
      if(req.method!=="GET" || !handles.some(h=>handle===`Bearer ${h.handle}`) || req.headers["content-length"] || req.headers["transfer-encoding"]) return deny()
      if (++requests > 32) return deny(429)
      const url=new URL(req.url??"")
      if (options.publicDocuments && url.origin==="http://semantic-scholar.scispark.invalid" && url.pathname==="/document" && !url.username && !url.password && !url.hash) {
        const target=url.searchParams.get("url")
        if ([...url.searchParams.keys()].length!==1 || !target || !documents.has(target)) return deny()
        if (++documentRequests > 4) return deny(429)
        const result=await requestPublicHttps(new URL(target),{Accept:"application/pdf"},524288,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]))
        if(result.status>=300 && result.status<400)return deny()
        if(result.status===401 || result.status===403)return deny(403)
        if(result.status!==200)return deny(502)
        if(!result.bytes.subarray(0,5).equals(Buffer.from("%PDF-")))return deny(422)
        res.writeHead(200,{"Content-Type":"application/pdf"});res.end(result.bytes);return
      }
      if(url.origin!=="http://semantic-scholar.scispark.invalid" || url.username || url.password || url.hash || url.pathname!=="/graph/v1/paper/search" || url.href.length>4000) return deny()
      if([...url.searchParams.keys()].length!==new Set(url.searchParams.keys()).size || !Query.safeParse(Object.fromEntries(url.searchParams)).success) return deny()
      // The persisted revision contains only a credential reference. Rotation is read from the owning storage on every request.
      const secret=await getServerS2Key(ctx.storage)
      if(!secret) return deny(503)
      const upstream=new URL("https://api.semanticscholar.org/graph/v1/paper/search");upstream.search=url.search
      const result=await requestPublicHttps(upstream,{"x-api-key":secret,Accept:"application/json"},2*1024*1024,AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]))
      if(result.status>=300 && result.status<400) return deny() // Never forward credentials to a redirect target.
      // Source may reflect a key in an error/body. Bound and redact before the command can capture it.
      const body=result.bytes.toString("utf8").replaceAll(secret,"[redacted]")
      if(options.publicDocuments && result.status===200) {
        const parsed=sourceRecords.safeParse(JSON.parse(body))
        if(!parsed.success)return deny(502)
        for(const paper of parsed.data.data) {
          if(!paper.isOpenAccess || !paper.openAccessPdf)continue
          try {
            const target=new URL(paper.openAccessPdf.url)
            if(target.protocol==="https:" && !target.username && !target.password && !target.port && !target.hash && documents.size<100)documents.add(paper.openAccessPdf.url)
          } catch { /* Invalid URLs never gain a grant. */ }
        }
      }
      res.writeHead(result.status,{"Content-Type":"application/json"});res.end(body)
    } catch (error) { if(!res.headersSent) deny(error instanceof DocumentSizeLimitError ? 413 : 502);else res.end() }
  })
  server.on("connect",(_req,socket)=>{socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")})
  server.requestTimeout=30000;server.headersTimeout=10000
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.removeListener("error",reject);resolve()})})
  const address=server.address()
  if(!address || typeof address==="string") {server.close();throw new Error("Broker binding unavailable")}
  const broker:ConnectionBroker=Object.freeze({handles,close:async()=>{
    const cap=capabilities.get(broker);if(!cap?.live)return;cap.live=false;abort.abort()
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
  }})
  capabilities.set(broker,{ctx,runId,port:address.port,live:true,handles})
  return broker
}
