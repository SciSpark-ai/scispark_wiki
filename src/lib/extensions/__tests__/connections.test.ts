import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { lookup } from "node:dns/promises"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import { NodeFsVaultStorage } from "../../vault/node-fs-storage"
import { buildSandboxPolicy, commandEnvironment } from "../sandbox-policy"
import { saveS2Key } from "../../server/paper-source-settings"
import { NATIVE_TOOL_MANIFESTS } from "../native-catalog"
import { toolKey } from "../contracts"
import { ToolRunSchema, DEFAULT_RUN_ALLOWANCE } from "../../workflows/contracts"
import { writeRun } from "../../workflows/store"
import { bindToolConnection, resolveCommandConnections, connectionRefsForTools, readConnectionRevision } from "../connections"
import { createConnectionBroker, connectionBrokerCapability, requestPublicHttps, type ConnectionBroker } from "../network-broker"
vi.mock("node:https",()=>({request:vi.fn()}))
vi.mock("node:dns/promises",()=>({lookup:vi.fn()}))
const secret="fixture-sensitive-s2-credential-123", roots:string[]=[],brokers:ConnectionBroker[]=[]
const tool=NATIVE_TOOL_MANIFESTS[0]
let upstreamStatus=200,upstreamBody="{}",upstreamCalls: Array<{url:URL;headers:Record<string,string>}>=[]
beforeEach(()=>{
  vi.stubEnv("S2_API_KEY","")
  upstreamStatus=200;upstreamBody="{}";upstreamCalls=[]
  vi.mocked(lookup).mockResolvedValue([{address:"1.1.1.1",family:4}] as never)
  vi.mocked(httpsRequest).mockImplementation(((url:URL,options:{headers:Record<string,string>},callback:(res:Readable)=>void)=>{
    upstreamCalls.push({url,headers:options.headers})
    const req=new EventEmitter() as EventEmitter & {end():void}
    req.end=()=>{const res=Readable.from([Buffer.from(upstreamBody)]);Object.assign(res,{statusCode:upstreamStatus});callback(res)}
    return req
  }) as typeof httpsRequest)
})
afterEach(async()=>{await Promise.all(brokers.splice(0).map(b=>b.close()));await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true})));vi.resetAllMocks();vi.unstubAllEnvs()})
async function fixture(){
  const root=await realpath(await mkdtemp(join(tmpdir(),"scispark-connections-")));roots.push(root)
  const vaultPath=join(root,"vault"),runtimeRoot=join(root,"runtime");await mkdir(vaultPath);await mkdir(runtimeRoot)
  const ctx={profileId:"b".repeat(32),vaultId:"a".repeat(64),vaultPath,runtimeRoot,storage:new NodeFsVaultStorage(vaultPath)}
  const binding={id:randomUUID(),service:"semantic-scholar" as const,adapter:"scispark-http-v1" as const,credentialHandle:"settings:paperSources.s2" as const}
  await bindToolConnection(ctx,toolKey(tool.ref),binding)
  const refs=await connectionRefsForTools(ctx,[tool.ref])
  const run=ToolRunSchema.parse({schemaVersion:1,id:randomUUID(),profileId:ctx.profileId,vaultId:ctx.vaultId,operationId:randomUUID(),tool:tool.ref,dependencies:[],input:{},contextRefs:[],model:{engine:"api",tierModels:{fast:{provider:"openai",model:"fixture"},strong:{provider:"openai",model:"fixture"}},roleTiers:{}},preparedEnvironmentRefs:[],connectionConfigurationRefs:refs,writeIntent:"outputs_only",allowance:DEFAULT_RUN_ALLOWANCE,usage:{modelCalls:0,commandCalls:0,activeSeconds:0,costUsd:0},status:"running",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),eventCursor:0,artifacts:[]})
  await writeRun(ctx,run)
  return {ctx,binding,run}
}
async function client(port:number,handle:string,path="http://semantic-scholar.scispark.invalid/graph/v1/paper/search?query=test",method="GET"){
  return new Promise<{status:number;text:string}>((resolve,reject)=>{
    const req=httpRequest({hostname:"127.0.0.1",port,path,method,headers:{"Proxy-Authorization":`Bearer ${handle}`}},res=>{let text="";res.on("data",chunk=>text+=chunk);res.on("end",()=>resolve({status:res.statusCode!,text}))})
    req.on("error",reject);req.end()
  })
}
async function prepared(publicDocuments=false){
  const f=await fixture();await saveS2Key(f.ctx.storage,secret)
  const {bindings}=await resolveCommandConnections(f.ctx,[f.binding.id])
  const broker=await createConnectionBroker(f.ctx,f.run.id,bindings,{publicDocuments});brokers.push(broker)
  const cap=connectionBrokerCapability(f.ctx,f.run.id,[f.binding.id],broker)
  return {...f,broker,cap}
}
describe("scoped source connections and inspected HTTP broker",()=>{
  it("keeps only opaque credential references and reports missing credentials",async()=>{
    const {ctx,binding,run}=await fixture()
    await expect(resolveCommandConnections(ctx,[binding.id])).rejects.toThrow("credentials")
    await saveS2Key(ctx.storage,secret)
    const resolved=await resolveCommandConnections(ctx,[binding.id])
    expect(JSON.stringify({run,resolved})).not.toContain(secret)
    await expect(resolveCommandConnections({...ctx,profileId:"c".repeat(32)},[binding.id])).rejects.toThrow("not selected")
    await expect(bindToolConnection(ctx,toolKey(tool.ref),{...binding,credentialHandle:secret} as never)).rejects.toThrow("non-secret")
    expect(await readConnectionRevision(ctx,run.connectionConfigurationRefs[0])).toMatchObject({id:binding.id})
  })
  it("rejects forged, cross-profile, cross-run and closed capabilities",async()=>{
    const {ctx,run,binding,broker}=await prepared()
    for(const args of [[ctx,run.id,[binding.id],{...broker}],[{...ctx,profileId:"c".repeat(32)},run.id,[binding.id],broker],[ctx,randomUUID(),[binding.id],broker]] as const)expect(()=>connectionBrokerCapability(args[0],args[1],[...args[2]],args[3])).toThrow("scoped")
    await broker.close();expect(()=>connectionBrokerCapability(ctx,run.id,[binding.id],broker)).toThrow("closed")
  })
  it("inspects destination/method/auth before host credential insertion and redacts reflections",async()=>{
    const {cap,broker}=await prepared();const handle=broker.handles[0].handle
    expect((await client(cap.port,"forged")).status).toBe(403)
    expect((await client(cap.port,handle,"http://evil.invalid/graph/v1/paper/search?query=test")).status).toBe(403)
    expect((await client(cap.port,handle,undefined,"POST")).status).toBe(403)
    expect(upstreamCalls).toHaveLength(0)
    upstreamBody=JSON.stringify({error:secret})
    const result=await client(cap.port,handle)
    expect(result).toMatchObject({status:200});expect(result.text).not.toContain(secret)
    expect(upstreamCalls[0].url.origin).toBe("https://api.semanticscholar.org")
    expect(upstreamCalls[0].headers["x-api-key"]).toBe(secret)
    expect(JSON.stringify(broker)).not.toContain(secret)
  })
  it("never follows redirects and resolves key rotation from captured storage",async()=>{
    const {ctx,cap,broker}=await prepared();upstreamStatus=302
    expect((await client(cap.port,broker.handles[0].handle)).status).toBe(403)
    expect(upstreamCalls).toHaveLength(1)
    upstreamStatus=200;await saveS2Key(ctx.storage,"rotated-fixture-key")
    await client(cap.port,broker.handles[0].handle)
    expect(upstreamCalls[1].headers["x-api-key"]).toBe("rotated-fixture-key")
  })
  it("refuses private DNS answers before any upstream connection",async()=>{
    for(const address of ["127.0.0.1","10.1.2.3","169.254.169.254","172.16.2.3","192.168.1.1","100.64.0.1","::1"]){
      vi.mocked(lookup).mockResolvedValue([{address,family:address.includes(":")?6:4}] as never)
      await expect(requestPublicHttps(new URL("https://api.semanticscholar.org/graph/v1/paper/search"),{},1000,new AbortController().signal)).rejects.toThrow("Private")
    }
    expect(httpsRequest).not.toHaveBeenCalled()
  })
  it("wires only the registered proxy port and non-secret handles into the command policy/environment",async()=>{
    const {ctx,run,binding,broker,cap}=await prepared()
    const scope={kind:"run" as const,id:run.id,profileId:ctx.profileId,vaultId:ctx.vaultId,packageRoot:"/fixture/package",outputRoot:"/fixture/output",tempRoot:"/fixture/tmp",runtimeReadRoots:["/usr/bin"],executablePaths:{node:"/fixture/runtime/bin/node"},resourceIds:[],connectionIds:[binding.id]}
    const policy=buildSandboxPolicy(scope,cap),env=commandEnvironment(scope,cap)
    expect(policy.network).toMatchObject({httpProxyPort:cap.port,allowedDomains:[],allowLocalBinding:false,allowAllUnixSockets:false,allowUnixSockets:[]})
    expect(policy.network).not.toHaveProperty("socksProxyPort")
    expect(env.SCISPARK_CONNECTION_HANDLES).toBe(JSON.stringify(broker.handles))
    expect(JSON.stringify({policy,env})).not.toContain(secret)
    expect(env.PATH?.split(":")[0]).toBe("/fixture/runtime/bin")
  })
  it("rejects CONNECT and malformed source paths without any upstream credential dispatch",async()=>{
    const {cap,broker}=await prepared(),handle=broker.handles[0].handle
    for(const path of ["http://semantic-scholar.scispark.invalid/other?query=test","http://user:password@semantic-scholar.scispark.invalid/graph/v1/paper/search?query=test","http://semantic-scholar.scispark.invalid/graph/v1/paper/search?query=a&query=b","http://semantic-scholar.scispark.invalid/graph/v1/paper/search?query=a&api_key=evil"])
      expect((await client(cap.port,handle,path)).status).toBe(403)
    const status=await new Promise<number>((resolve,reject)=>{
      const req=httpRequest({hostname:"127.0.0.1",port:cap.port,method:"CONNECT",path:"api.semanticscholar.org:443",headers:{"Proxy-Authorization":`Bearer ${handle}`}})
      req.on("connect",(res,socket)=>{socket.destroy();resolve(res.statusCode!)});req.on("error",reject);req.end()
    })
    expect(status).toBe(403);expect(upstreamCalls).toHaveLength(0)
  })

  it("uses captured configuration after the mutable binding is removed",async()=>{
    const {ctx,binding,run}=await fixture();await saveS2Key(ctx.storage,secret)
    const record=await readConnectionRevision(ctx,run.connectionConfigurationRefs[0])
    await new NodeFsVaultStorage(join(ctx.runtimeRoot,"profiles",ctx.profileId)).delete("connections/bindings.json")
    await expect(resolveCommandConnections(ctx,[binding.id])).rejects.toThrow("not selected")
    const broker=await createConnectionBroker(ctx,run.id,[record]);brokers.push(broker)
    const cap=connectionBrokerCapability(ctx,run.id,[binding.id],broker)
    expect((await client(cap.port,broker.handles[0].handle)).status).toBe(200)
  })

})

// Actual loopback broker with deterministic HTTPS/DNS fixtures; no real source I/O.
describe("OpenCite observed public document capability",()=>{
  it("only grants exact URLs in validated successful source records, with no credential forwarding",async()=>{
    const {cap,broker}=await prepared(true),handle=broker.handles[0].handle
    const url="https://publisher.example/open.pdf",document="http://semantic-scholar.scispark.invalid/document?url="+encodeURIComponent(url)
    expect((await client(cap.port,handle,document)).status).toBe(403)
    upstreamBody=JSON.stringify({data:[{title:"Paper",isOpenAccess:true,openAccessPdf:{url}}]})
    expect((await client(cap.port,handle)).status).toBe(200)
    upstreamBody="%PDF-1.4 fixture"
    expect((await client(cap.port,handle,document)).text).toBe(upstreamBody)
    expect(upstreamCalls.at(-1)?.headers).not.toHaveProperty("x-api-key")
    expect((await client(cap.port,handle,document+"%3Fchanged")).status).toBe(403)
    const another=await prepared(true)
    expect((await client(another.cap.port,another.broker.handles[0].handle,document)).status).toBe(403)
  })
  it("fails closed on restart, invalid records, private DNS, redirects and oversized documents",async()=>{
    const {ctx,run,binding,cap,broker}=await prepared(true),handle=broker.handles[0].handle
    const url="https://publisher.example/open.pdf",document="http://semantic-scholar.scispark.invalid/document?url="+encodeURIComponent(url)
    upstreamBody=JSON.stringify({data:[{title:42,isOpenAccess:true,openAccessPdf:{url}}]})
    expect((await client(cap.port,handle)).status).toBe(502)
    expect((await client(cap.port,handle,document)).status).toBe(403)
    upstreamBody=JSON.stringify({data:[{title:"Paper",isOpenAccess:true,openAccessPdf:{url}}]})
    await client(cap.port,handle)
    vi.mocked(lookup).mockResolvedValue([{address:"127.0.0.1",family:4}] as never)
    expect((await client(cap.port,handle,document)).status).toBe(502)
    vi.mocked(lookup).mockResolvedValue([{address:"1.1.1.1",family:4}] as never)
    upstreamStatus=302
    expect((await client(cap.port,handle,document)).status).toBe(403)
    // A new broker has no grants even for the same captured run/connection.
    const replacement=await createConnectionBroker(ctx,run.id,[await readConnectionRevision(ctx,run.connectionConfigurationRefs[0])],{publicDocuments:true});brokers.push(replacement)
    const next=connectionBrokerCapability(ctx,run.id,[binding.id],replacement)
    expect((await client(next.port,replacement.handles[0].handle,document)).status).toBe(403)
  })
})

it("bounds document bytes and refuses an already aborted DNS request before dispatch",async()=>{
  const aborted=new AbortController();aborted.abort()
  await expect(requestPublicHttps(new URL("https://publisher.example/open.pdf"),{},524288,aborted.signal)).rejects.toThrow()
  expect(httpsRequest).not.toHaveBeenCalled()
  const {cap,broker}=await prepared(true),url="https://publisher.example/open.pdf"
  upstreamBody=JSON.stringify({data:[{title:"Paper",isOpenAccess:true,openAccessPdf:{url}}]})
  await client(cap.port,broker.handles[0].handle)
  upstreamBody="%PDF-"+"x".repeat(524288)
  expect((await client(cap.port,broker.handles[0].handle,"http://semantic-scholar.scispark.invalid/document?url="+encodeURIComponent(url))).status).toBe(502)
})

it("retains HTTP source provenance without granting document retrieval",async()=>{
  const {cap,broker}=await prepared(true),url="http://publisher.example/open.pdf",paperUrl="http://www.semanticscholar.org/paper/abc"
  upstreamBody=JSON.stringify({data:[{title:"Paper",url:paperUrl,isOpenAccess:true,openAccessPdf:{url}}]})
  const source=await client(cap.port,broker.handles[0].handle)
  expect(source.status).toBe(200)
  expect(JSON.parse(source.text).data[0]).toMatchObject({url:paperUrl,openAccessPdf:{url}})
  expect((await client(cap.port,broker.handles[0].handle,"http://semantic-scholar.scispark.invalid/document?url="+encodeURIComponent(url))).status).toBe(403)
  expect(upstreamCalls).toHaveLength(1)
  expect(upstreamCalls[0].url.origin).toBe("https://api.semanticscholar.org")
})
