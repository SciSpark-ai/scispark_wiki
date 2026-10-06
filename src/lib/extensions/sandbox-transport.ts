import { fork } from "node:child_process"
import { readFile, mkdir, realpath } from "node:fs/promises"
import { join, sep } from "node:path"
import type { CommandInvocationSchema, CommandResult } from "./import-contract"
import type { connectionBrokerCapability } from "./network-broker"
import { buildSandboxPolicy, commandEnvironment, quoteCommand, type CommandScope } from "./sandbox-policy"
const workerPath = join(process.cwd(), "scripts/tool-command-worker.mjs")
const canonical = (path: string) => realpath(/* turbopackIgnore: true */ path)
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep)

type WorkerRequest = { id: string; command: string; cwd: string; env: NodeJS.ProcessEnv; policy: ReturnType<typeof buildSandboxPolicy>; timeoutMs: number; outputBytes: number } & ({ mode: "command"; probeDns?: never } | { mode: "probe"; probeDns?: true })
type WorkerResult = Pick<CommandResult, "exitCode" | "stdout" | "stderr" | "termination">
/** IPC does not reach the command: its descriptors are only stdin/out/err. */
export function launch(request: WorkerRequest, signal?: AbortSignal, control?: { armedPath: string; action: "cancel" | "disconnect" | "kill-worker" }): Promise<WorkerResult> {
  return new Promise(resolve => {
    const worker = fork(/* turbopackIgnore: true */ workerPath, [], { env: request.env, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] })
    let finished = false, disconnected = false
    let armPoll: ReturnType<typeof setInterval> | undefined
    const complete = (result: WorkerResult) => { if (finished) return; finished = true; clearTimeout(watchdog); clearInterval(armPoll); signal?.removeEventListener("abort", cancel); resolve(result) }
    const cancel = () => { if (worker.connected) worker.send({ type: "cancel" }) }
    // If supervisor hangs/crashes, its Linux bwrap parent-death binding owns the
    // namespace. On other systems ownership must pass the actual probe first.
    const watchdog = setTimeout(() => { worker.kill("SIGKILL"); complete({ exitCode: null, stdout: "", stderr: "", termination: "worker-lost" }) }, request.timeoutMs + 15_000)
    worker.on("message", message => {
      const msg = message as { type?: string; result?: WorkerResult }
      if (msg.type === "started" && control) armPoll = setInterval(() => {
        void readFile(control.armedPath, "utf8").then(value => {
          if (value !== "armed" || !worker.connected) return
          clearInterval(armPoll)
          if (control.action === "disconnect") { disconnected = true; worker.disconnect() } else if (control.action === "kill-worker") worker.kill("SIGKILL"); else cancel()
        }).catch(() => {})
      }, 20)
      if (msg.type === "result" && msg.result) complete(msg.result)
    })
    worker.once("error", () => complete({ exitCode: null, stdout: "", stderr: "", termination: "unavailable" }))
    worker.once("exit", () => complete({ exitCode: null, stdout: "", stderr: "", termination: disconnected ? "parent-disconnect" : "worker-lost" }))
    signal?.addEventListener("abort", cancel, { once: true })
    worker.send({ type: "start", request })
    if (signal?.aborted) cancel()
  })
}
export async function requestFor(scope: CommandScope, invocation: ReturnType<typeof CommandInvocationSchema.parse>, connection?: ReturnType<typeof connectionBrokerCapability>): Promise<WorkerRequest> {
  const executable = Object.hasOwn(scope.executablePaths, invocation.executableId) ? scope.executablePaths[invocation.executableId] : undefined
  if (!executable) throw new Error("Unapproved executable")
  if (invocation.connectionIds.length && !connection) throw new Error("Authenticated connection broker is not prepared")
  if (invocation.resourceIds.some(id => scope.kind !== "run" || !scope.resourceIds.includes(id))) throw new Error("Unapproved research resource")
  const cwd = await canonical(join(scope.outputRoot, invocation.cwd))
  if (!inside(scope.outputRoot, cwd)) throw new Error("Command cwd escapes output")
  const env = commandEnvironment(scope, connection)
  for (const path of [env.HOME!, env.XDG_CACHE_HOME!, env.XDG_CONFIG_HOME!]) await mkdir(path, { recursive: true, mode: 0o700 })
  // Runtime installs its own proxy env. Override only its shared TMPDIR choice.
  const command = quoteCommand("/usr/bin/env", [`TMPDIR=${scope.tempRoot}`, executable, ...invocation.argv])
  return { mode: "command", id: invocation.id, command, cwd, env, policy: buildSandboxPolicy(scope, connection), timeoutMs: invocation.timeoutMs, outputBytes: invocation.outputBytes }
}
