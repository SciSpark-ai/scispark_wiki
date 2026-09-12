import { spawn } from "node:child_process"
import { homedir } from "node:os"
import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { join, isAbsolute } from "node:path"
import type { LocalEngine } from "./contracts"
import { LLMError } from "../llm/types"

/** Deliberate allowlist: never inherit API keys, endpoints, CLI hooks, nested
 * agent state or shell startup configuration from the SciSpark process. */
export function engineEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" }
  for (const key of ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT", "SystemRoot"])
    if (source[key]) env[key] = source[key]
  env.PATH = [env.PATH, join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(":")
  env.NO_COLOR = "1"
  return env
}
export async function engineExecutable(engine: LocalEngine): Promise<string> {
  const name = engine === "codex" ? "codex" : "claude"
  // Overrides are server launch configuration, never request/settings fields.
  const override = process.env[engine === "codex" ? "SCISPARK_CODEX_PATH" : "SCISPARK_CLAUDE_PATH"]
  const candidates = override ? [override] : (engineEnvironment().PATH ?? "").split(":").filter(isAbsolute).map((p) => join(p, name))
  for (const path of candidates) {
    if (!isAbsolute(path)) continue
    try { await access(path, constants.X_OK); return path } catch { /* next */ }
  }
  throw new LLMError(`${engine === "codex" ? "Codex" : "Claude Code"} is not installed. Install its CLI and sign in, then check again.`)
}
export interface ProcessRequest {
  executable: string; args: string[]; cwd: string; input?: string
  timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void
}
export interface ProcessResult { code: number | null; stdout: string; stderr: string }
export function runEngineProcess(req: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (req.signal?.aborted) { reject(new LLMError("AI request cancelled.")); return }
    const child = spawn(req.executable, req.args, { cwd: req.cwd, env: engineEnvironment(), stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32", shell: false })
    let stdout = "", stderr = "", pending = "", failure: Error | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch { /* already exited */ }
    }
    const stop = (error: Error) => {
      if (failure) return
      failure = error; kill("SIGTERM")
      killTimer = setTimeout(() => kill("SIGKILL"), 1500)
      killTimer.unref()
    }
    const abort = () => stop(new LLMError("AI request cancelled. Usage may already have been consumed."))
    const timer = setTimeout(() => stop(new LLMError("Local AI timed out. Usage may already have been consumed; no automatic retry was made.")), req.timeoutMs)
    req.signal?.addEventListener("abort", abort, { once: true })
    const cleanup = () => { clearTimeout(timer); if (killTimer) { clearTimeout(killTimer); kill("SIGKILL") }; req.signal?.removeEventListener("abort", abort) }
    child.on("error", () => { cleanup(); reject(new LLMError("Could not start the local AI runtime. Check its installation and permissions.")) })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (text: string) => {
      stdout += text; pending += text
      if (Buffer.byteLength(stdout) > 8_000_000) { stop(new LLMError("Local AI output exceeded the response limit.")); return }
      let end: number
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1)
        try { req.onLine?.(line) } catch { stop(new LLMError("The local AI runtime returned an unsupported response.")) }
      }
    })
    child.stderr.on("data", (text: string) => { stderr = (stderr + text).slice(-32_000) })
    child.stdin.on("error", () => { /* close/error determines result; avoid EPIPE crash */ })
    child.once("close", (code) => {
      cleanup()
      if (failure) { reject(failure); return }
      try { if (pending.trim()) req.onLine?.(pending); resolve({ code, stdout, stderr }) }
      catch { reject(new LLMError("The local AI runtime returned an unsupported response.")) }
    })
    child.stdin.end(req.input ?? "")
  })
}
