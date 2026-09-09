#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")
const DIST_DIR = ".next-e2e"
// Optionally test an already-built production artifact with the same disposable
// vault/ports. Never reuse the human-test server or delete the supplied build.
const productionDist = process.env.SCISPARK_E2E_PRODUCTION_DIST_DIR
if (productionDist && (!/^\.next-[a-zA-Z0-9_-]+$/.test(productionDist)
  || !existsSync(join(REPO_ROOT, productionDist, "BUILD_ID")))) {
  throw new Error("SCISPARK_E2E_PRODUCTION_DIST_DIR must name an existing .next-* production build in this repository.")
}
const RUN_DIR = mkdtempSync(join(tmpdir(), "scispark-e2e-"))
const PLAYWRIGHT_CLI = join(REPO_ROOT, "node_modules", "@playwright", "test", "cli.js")

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("could not allocate a loopback port"))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true

  const runParent = dirname(RUN_DIR)
  if (runParent !== resolve(tmpdir()) || !basename(RUN_DIR).startsWith("scispark-e2e-")) {
    throw new Error(`refusing to clean unexpected E2E run directory: ${RUN_DIR}`)
  }
  const distPath = join(REPO_ROOT, DIST_DIR)
  if (dirname(distPath) !== REPO_ROOT || basename(distPath) !== ".next-e2e") {
    throw new Error(`refusing to clean unexpected E2E build directory: ${distPath}`)
  }

  rmSync(RUN_DIR, { recursive: true, force: true })
  if (!productionDist) rmSync(distPath, { recursive: true, force: true })
}

const [appPort, llmPort] = await Promise.all([findFreePort(), findFreePort()])
const child = spawn(process.execPath, [PLAYWRIGHT_CLI, "test", ...process.argv.slice(2)], {
  cwd: REPO_ROOT,
  stdio: "inherit",
  env: {
    ...process.env,
    SCISPARK_E2E_RUN_DIR: RUN_DIR,
    SCISPARK_E2E_APP_PORT: String(appPort),
    SCISPARK_E2E_LLM_PORT: String(llmPort),
    SCISPARK_E2E_DIST_DIR: productionDist ?? DIST_DIR,
    SCISPARK_E2E_SERVER_MODE: productionDist ? "start" : "dev",
  },
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.once("error", (error) => {
  cleanup()
  throw error
})
child.once("exit", (code, signal) => {
  cleanup()
  if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143
    return
  }
  process.exitCode = code ?? 1
})
