import { z } from "zod"
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime"
import { ProfileIdSchema, DigestSchema, UuidSchema } from "./contracts"

// This is a server-only capability. Never parse it from an HTTP/model payload.
const Root = z.string().min(2).refine(p => p.startsWith("/") && !/[\x00-\x1f*?\[\]{}~]/.test(p) && !p.split("/").some(s => s === "." || s === "..") && !p.endsWith("/"))
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/)
const fields = {
  id: UuidSchema, profileId: ProfileIdSchema, vaultId: DigestSchema,
  packageRoot: Root, outputRoot: Root, tempRoot: Root,
  runtimeReadRoots: z.array(Root).min(1).max(50), executablePaths: z.record(Id, Root),
}
export const CommandScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), ...fields, researchRoot: Root.optional(), resourceIds: z.array(Id).max(1000), connectionIds: z.array(Id).max(100) }).strict(),
  z.object({ kind: z.literal("setup"), ...fields, registryDomains: z.array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/).refine(d => !d.endsWith(".localhost") && !d.endsWith(".local"))).max(30) }).strict(),
])
export type CommandScope = z.infer<typeof CommandScopeSchema>
export function validateCommandScope(value: unknown): CommandScope { return CommandScopeSchema.parse(value) }
export function buildSandboxPolicy(scope: CommandScope): SandboxRuntimeConfig {
  return {
    filesystem: {
      denyRead: ["/"],
      allowRead: [...scope.runtimeReadRoots, scope.packageRoot, scope.outputRoot, scope.tempRoot, ...(scope.kind === "run" && scope.researchRoot ? [scope.researchRoot] : [])],
      allowWrite: [scope.outputRoot, scope.tempRoot],
      // The upstream runtime implicitly permits these shared paths. Override it.
      denyWrite: ["/tmp/claude", "/private/tmp/claude", scope.packageRoot, ...(scope.kind === "run" && scope.researchRoot ? [scope.researchRoot] : [])],
    },
    network: {
      allowedDomains: scope.kind === "setup" ? scope.registryDomains : [], deniedDomains: [],
      // Extend the runtime's mandatory loopback/link-local/metadata denials.
      // An allowed registry name must not become a route into private networks.
      deniedResolvedAddresses: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7"],
      allowLocalBinding: false, allowAllUnixSockets: false, allowUnixSockets: [],
    },
    enableWeakerNestedSandbox: false, enableWeakerNetworkIsolation: false,
  }
}
export function commandEnvironment(scope: Pick<CommandScope, "tempRoot" | "executablePaths">): NodeJS.ProcessEnv {
  return { NODE_ENV: "production", HOME: scope.tempRoot + "/home", XDG_CACHE_HOME: scope.tempRoot + "/cache", XDG_CONFIG_HOME: scope.tempRoot + "/config", TMPDIR: scope.tempRoot,
    PATH: "/usr/bin:/bin", LANG: "C" }
}
/** The runtime's POSIX API requires shell text. This is the ONLY conversion;
 * executable IDs are resolved host-side, and every argv byte remains literal. */
export function quoteCommand(executable: string, argv: string[]): string {
  const quote = (s: string) => { if (s.includes("\0")) throw new Error("NUL command argument"); return "'" + s.replaceAll("'", "'\\''") + "'" }
  return "exec " + [executable, ...argv].map(quote).join(" ")
}
