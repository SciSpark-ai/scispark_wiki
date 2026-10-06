#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, mkdirSync, realpathSync, readdirSync, lstatSync, copyFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve, isAbsolute, relative } from "node:path"
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
const selectedSpecs = process.argv.slice(2).filter(arg => arg.includes(".spec."))
const modularSpec = /(?:^|\/)(tool-(choice|background|restart|profile-isolation|review)|tools-library)\.spec\.ts$/
const modularFixture = selectedSpecs.length === 0 || selectedSpecs.some(arg => modularSpec.test(arg))
const emptyFixture = selectedSpecs.length > 0 && selectedSpecs.every(arg => modularSpec.test(arg))
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

const artifactOutput = process.env.SCISPARK_E2E_ARTIFACT_DIR
let evidenceOutput
function rejectArtifact(message) { rmSync(RUN_DIR, { recursive: true, force: true }); throw new Error(message) }
if (artifactOutput) {
  if (!isAbsolute(artifactOutput) || resolve(artifactOutput) === "/") rejectArtifact("Artifact output must be an explicit absolute directory")
  // Resolve existing ancestors before creating anything, including symlink aliases.
  let ancestor = resolve(artifactOutput)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, resolve(artifactOutput)))
  const overlaps = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/")
  if ([RUN_DIR, join(REPO_ROOT, "test-results"), join(REPO_ROOT, DIST_DIR), ...(productionDist ? [join(REPO_ROOT, productionDist)] : [])].some(root => overlaps(canonical, realpathSync(dirname(root)) + "/" + basename(root)))) {
    rejectArtifact("Artifact output must be outside disposable vault/profile/build and evidence-source roots")
  }
  mkdirSync(canonical, { recursive: true })
  evidenceOutput = mkdtempSync(join(canonical, "acceptance-"))
}
function preserveEvidence(code) {
  if (!evidenceOutput) return
  let bytes = 0, files = 0, entries = 0
  const copy = (source, destination) => {
    if (!existsSync(source)) return
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (++entries > 1000) throw new Error("Evidence exceeds the 1000-entry bound")
      const from = join(source, entry.name), to = join(destination, entry.name)
      if (entry.isSymbolicLink()) throw new Error("Evidence symlinks are not allowed")
      if (entry.isDirectory()) { copy(from, to); continue }
      if (!/\.(png|json|jsonl|log|txt)$/.test(entry.name)) continue
      const stat = lstatSync(from)
      if (!stat.isFile() || ++files > 300 || (bytes += stat.size) > 64 * 1024 * 1024) throw new Error("Evidence exceeds the 300-file / 64 MiB bound")
      mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to)
    }
  }
  copy(join(RUN_DIR, "evidence"), join(evidenceOutput, "evidence"))
  copy(join(REPO_ROOT, "test-results"), join(evidenceOutput, "browser"))
  writeFileSync(join(evidenceOutput, "acceptance.json"), JSON.stringify({ exitCode: code, mode: productionDist ? "production" : "development", distDir: productionDist ?? DIST_DIR, specs: process.argv.slice(2), files, bytes, liveProviders: false }, null, 2))
  console.log(`SciSpark E2E evidence retained: ${evidenceOutput}`)
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
    SCISPARK_E2E_MODULAR_FIXTURE: modularFixture ? "1" : "0",
    SCISPARK_E2E_EMPTY_VAULT: emptyFixture ? "1" : "0",
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
  try { preserveEvidence(code) } catch (error) { console.error(error); process.exitCode = 1; cleanup(); return }
  cleanup()
  if (signal) {
    process.exitCode = signal === "SIGINT" ? 130 : 143
    return
  }
  process.exitCode = code ?? 1
})
