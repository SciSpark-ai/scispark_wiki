import { tmpdir } from "node:os"
import type { EngineStatus, LocalEngine } from "./contracts"
import { engineLabel } from "./contracts"
import { engineExecutable, runEngineProcess } from "./process"

export function supportedVersion(engine: LocalEngine, version: string): boolean {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return false
  const [major, minor, patch] = match.slice(1).map(Number)
  return engine === "codex" ? major === 0 && minor === 146 : major === 2 && minor === 1 && patch >= 210
}
export async function localEngineStatus(engine: LocalEngine): Promise<EngineStatus> {
  let executable: string
  try { executable = await engineExecutable(engine) } catch {
    return { engine, state: "missing", message: `Install ${engineLabel(engine)} CLI, then sign in using ${engine === "codex" ? "codex login" : "claude auth login"}.` }
  }
  try {
    const versionResult = await runEngineProcess({ executable, args: ["--version"], cwd: tmpdir(), timeoutMs: 10_000 })
    const version = versionResult.stdout.match(/\d+\.\d+\.\d+/)?.[0]
    if (versionResult.code !== 0 || !version || !supportedVersion(engine, version)) return { engine, version, state: "unsupported", message: engine === "codex" ? "This integration requires Codex CLI 0.146.x." : "This integration requires Claude Code 2.1.210 or later in the 2.1 series." }
    const auth = await runEngineProcess({ executable, args: engine === "codex" ? ["login", "status"] : ["auth", "status", "--json"], cwd: tmpdir(), timeoutMs: 10_000 })
    const loggedIn = engine === "codex" ? auth.code === 0 && /logged in using chatgpt/i.test(auth.stdout + auth.stderr)
      : (() => { try { const a = JSON.parse(auth.stdout); return auth.code === 0 && a.loggedIn === true && a.authMethod === "claude.ai" } catch { return false } })()
    return { engine, version, state: loggedIn ? "ready" : "signed-out", message: loggedIn
      ? `${engineLabel(engine)} is signed in. Uses your plan's limits; selected context is sent to the provider.`
      : `Sign in with your subscription using ${engine === "codex" ? "codex login" : "claude auth login"}, then check again. API-key sessions are not used by this connection.` }
  } catch { return { engine, state: "unavailable", message: `Could not check ${engineLabel(engine)}. Check the local installation and try again.` } }
}
