import { mkdir, realpath, access } from "node:fs/promises"
import { constants } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import type { WorkflowContext } from "../workflows/context"
import { NodeFsVaultStorage } from "../vault/node-fs-storage"
import { profileRuntimePath } from "./store"
import { DigestSchema, UuidSchema } from "./contracts"
import { sha256 } from "./acquire"
import { createCommandContext, runIsolatedCommand } from "./sandbox"
import { requestPublicHttps } from "./network-broker"
export const ToolchainPinSchema=z.object({runtime:z.enum(["node22","python3.12"]),version:z.string(),platform:z.string(),arch:z.string(),url:z.url(),sha256:DigestSchema,metadataUrl:z.url()}).strict()
export type ToolchainPin=z.infer<typeof ToolchainPinSchema>
const nodeHashes:Record<string,string>={
  "darwin-arm64":"5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640",
  "darwin-x64":"5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce",
  "linux-arm64":"25ba95dfb96871fa2ef977f11f95ea90818c8fa15c0f2110771db08d4ba423be",
  "linux-x64":"c33c39ed9c80deddde77c960d00119918b9e352426fd604ba41638d6526a4744",
}
/** Exact official metadata inspected 2026-10-05; no latest-version resolution at execution time. */
export function resolveToolchainPin(runtime:"node22"|"python3.12",platform:string=process.platform,arch:string=process.arch):ToolchainPin {
  if(!nodeHashes[`${platform}-${arch}`]) throw new Error("Managed runtime platform is unsupported")
  return runtime==="node22"
    ? {runtime,version:"22.22.0",platform,arch,url:`https://nodejs.org/dist/v22.22.0/node-v22.22.0-${platform}-${arch}.tar.gz`,sha256:nodeHashes[`${platform}-${arch}`],metadataUrl:"https://nodejs.org/dist/v22.22.0/SHASUMS256.txt"}
    : {runtime,version:"3.12.12",platform,arch,url:"https://www.python.org/ftp/python/3.12.12/Python-3.12.12.tar.xz",sha256:"fb85a13414b028c49ba18bbd523c2d055a30b56b18b92ce454ea2c51edc656c4",metadataUrl:"https://www.python.org/ftp/python/3.12.12/Python-3.12.12.tar.xz.sigstore"}
}
export interface PreparedToolchain {root:string;executablePaths:Record<string,string>;runtimeReadRoots:string[]}
export class ToolchainNeedsSetupError extends Error {}
export class SetupInterruptedError extends Error {constructor(readonly uncertain:boolean){super(uncertain?"Setup staging requires reconciliation":"Setup step failed or exceeded its limit; inspect prerequisites and retry")}}
async function systemPrerequisites(python:boolean){
  const executables:Record<string,string>={}
  for(const [name,path] of Object.entries({tar:"/usr/bin/tar",...(python?{sh:"/bin/sh",make:"/usr/bin/make",cc:"/usr/bin/cc"}:{})})){
    try{await access(path,constants.X_OK);executables[name]=await realpath(path)}catch{throw new ToolchainNeedsSetupError(`Required host build prerequisite is unavailable: ${name}`)}
  }
  const roots:string[]=[]
  for(const path of ["/bin","/usr/bin","/usr/lib","/lib","/lib64",...(python?["/usr/include"]:[])]) {
    try{roots.push(await realpath(path))}catch{/* Optional platform system root. */}
  }
  if(Object.values(executables).some(path=>!roots.some(root=>path.startsWith(root+"/")))) throw new ToolchainNeedsSetupError("Build prerequisite resolves outside approved system roots")
  return {executablePaths:executables,runtimeReadRoots:[...new Set(roots)]}
}
/** Installs only into the existing stable setup staging root. Every extraction/build
 * is a Task8 command; package commands never run on the unrestricted host. */
export async function prepareToolchain(ctx:WorkflowContext,setupId:string,pin:ToolchainPin,stage:string,packageDigest:string):Promise<PreparedToolchain>{
  ToolchainPinSchema.parse(pin);UuidSchema.parse(setupId)
  if(stage!==join(profileRuntimePath(ctx),"commands","setup",setupId,"output") || await realpath(stage)!==stage)throw new Error("Untrusted setup staging root")
  if(JSON.stringify(pin)!==JSON.stringify(resolveToolchainPin(pin.runtime))) throw new Error("Untrusted toolchain artifact")
  const storage=new NodeFsVaultStorage(stage)
  const prerequisites=await systemPrerequisites(pin.runtime==="python3.12")
  // Resolve and persist the exact artifact before any download/build/dependency operation.
  await storage.write("toolchain-pin.json",JSON.stringify(pin))
  const archive=pin.runtime==="node22"?"runtime.tar.gz":"runtime.tar.xz"
  let bytes=await storage.readBinary(archive)
  if(!bytes){
    const response=await requestPublicHttps(new URL(pin.url),{},60*1024*1024,AbortSignal.timeout(60000)).catch(()=>{throw new ToolchainNeedsSetupError("Official runtime download unavailable; retry when the official release host is reachable")})
    if(response.status!==200)throw new ToolchainNeedsSetupError("Official runtime download unavailable; retry when the official release host is reachable")
    bytes=response.bytes
    if(sha256(bytes)!==pin.sha256)throw new ToolchainNeedsSetupError("Official runtime checksum mismatch; inspect the managed download before retry")
    await storage.writeBinary(archive,bytes)
  }
  if(sha256(bytes)!==pin.sha256)throw new ToolchainNeedsSetupError("Official runtime checksum mismatch; inspect the managed download before retry")
  const root=join(stage,"runtime")
  await mkdir(root,{recursive:true,mode:0o700})
  const scope=await createCommandContext(ctx,{kind:"setup",id:setupId,packageDigest,...prerequisites,registryDomains:[]})
  const step=async(executableId:string,argv:string[],cwd=".")=>{
    const result=await runIsolatedCommand(scope,setupId,{id:randomUUID(),executableId,argv,cwd,resourceIds:[],connectionIds:[]},new AbortController().signal)
    if(result.uncertain || result.exitCode!==0 || result.termination!=="exited")throw new SetupInterruptedError(result.uncertain)
  }
  const extracted=pin.runtime==="node22"?"runtime":"python-source"
  await mkdir(join(stage,extracted),{recursive:true,mode:0o700})
  await step("tar",["-xf",join(stage,archive),"--strip-components=1","-C",join(stage,extracted)])
  if(pin.runtime==="python3.12"){
    // No package-manager/compiler bootstrap: explicit system prerequisites only.
    await step("sh",["./configure",`--prefix=${root}`,"--with-ensurepip=install"],"python-source")
    await step("make",["-j2"],"python-source")
    await step("make",["install"],"python-source")
  }
  const executable=join(root,"bin",pin.runtime==="node22"?"node":"python3.12")
  await access(executable,constants.X_OK)
  return {root,executablePaths:{[pin.runtime==="node22"?"node":"python"]:executable},runtimeReadRoots:[...prerequisites.runtimeReadRoots,root]}
}
