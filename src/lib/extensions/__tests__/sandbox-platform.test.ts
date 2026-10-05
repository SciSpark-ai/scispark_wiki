import { writeFile } from "node:fs/promises"
import { fork } from "node:child_process"
import { join } from "node:path"
import { expect, it } from "vitest"
import { probeSandbox } from "../sandbox"

it.each([true, false, { "custom.invalid": "127.0.0.1" }])("rejects probe DNS controls on a normal worker request (%j)", async probeDns => {
  const worker = fork(join(process.cwd(), "scripts/tool-command-worker.mjs"), [], { env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" }, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] })
  try {
    const result = await new Promise<{ termination: string; stderr: string }>((resolve, reject) => {
      worker.once("error", reject)
      worker.once("message", message => resolve((message as { result: { termination: string; stderr: string } }).result))
      worker.send({ type: "start", request: { mode: "command", probeDns, timeoutMs: 1000, outputBytes: 1000 } })
    })
    expect(result).toMatchObject({ termination: "unavailable", stderr: "Invalid internal probe controls" })
  } finally { if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL") }
}, 5000)

// Explicit platform job: normal unit tests never claim a skipped OS probe passed.
it.runIf(process.env.SCISPARK_SANDBOX_PLATFORM === "1")("probes the actual pinned runtime worker against disposable host sentinels", async () => {
  const result = await probeSandbox()
  if (process.env.SCISPARK_SANDBOX_EVIDENCE) await writeFile(process.env.SCISPARK_SANDBOX_EVIDENCE, JSON.stringify(result, null, 2))
  console.log("SANDBOX_PLATFORM_EVIDENCE=" + JSON.stringify(result))
  expect(result.runtimeVersion).toBe("0.0.78")
  expect(result.evidence.length).toBeGreaterThan(0)
  if (result.evidence.find(row => row.check === "actual-worker")?.status === "passed") {
    expect(result.evidence.find(row => row.check === "setup-proxy-private-resolution")?.status).toBe("passed")
  }
  if (process.env.SCISPARK_SANDBOX_REQUIRE_READY === "1") expect(result.status).toBe("ready")
  else if (result.status === "ready") expect(result.evidence.every(row => row.status === "passed")).toBe(true)
  else expect(result.evidence.some(row => row.status !== "passed")).toBe(true)
}, 60000)
