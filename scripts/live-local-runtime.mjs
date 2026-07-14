#!/usr/bin/env node
// M11 Task 12 — live gate: spawns a REAL `next dev` server against a scratch
// on-disk vault and drives it end-to-end over plain `fetch`, proving the
// whole M11 local-runtime pivot (vault on disk + skills-as-server-routes vs
// the old browser/GMI-proxy world). This is a plain Node ESM script, NOT a
// vitest test — vitest doesn't spawn real child servers.
//
// Run WITHOUT keys (free smoke test, steps 1-3 only, step 4 skipped):
//   node scripts/live-local-runtime.mjs
//
// Run WITH keys (adds step 4 — one real trending-refresh LLM call, ~$0.04):
//   LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
//   LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
//   LIVE_LLM_API_KEY=<key> \
//   node scripts/live-local-runtime.mjs
//
// Optional: LIVE_LOCAL_PORT to override the scratch port (default 3999).

import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const NEXT_BIN = join(REPO_ROOT, "node_modules", ".bin", "next")

const PORT = Number(process.env.LIVE_LOCAL_PORT ?? 3999)
const BASE_URL = `http://localhost:${PORT}`
const READY_TIMEOUT_MS = 90_000
const READY_POLL_INTERVAL_MS = 1000

const LIVE_LLM_BASE_URL = process.env.LIVE_LLM_BASE_URL
const LIVE_LLM_API_KEY = process.env.LIVE_LLM_API_KEY
const LIVE_LLM_MODEL = process.env.LIVE_LLM_MODEL
const HAS_LIVE_LLM = Boolean(LIVE_LLM_BASE_URL && LIVE_LLM_API_KEY && LIVE_LLM_MODEL)

// Step 3 (settings PUT/GET redaction) must pass even without real keys, so it
// exercises real key-hygiene logic either way — fall back to inert dummy
// values when LIVE_LLM_* isn't set.
const SETTINGS_BASE_URL = LIVE_LLM_BASE_URL ?? "https://example.invalid/v1"
const SETTINGS_API_KEY = LIVE_LLM_API_KEY ?? "dummy-test-key-for-hygiene-check"
const SETTINGS_MODEL = LIVE_LLM_MODEL ?? "dummy-model"

const RESERVED_FILES = ["schema.md", "purpose.md", "index.md", "log.md"]

let overallOk = true
const results = []

function record(step, ok, detail) {
  results.push({ step, ok, detail })
  overallOk = overallOk && ok
  const tag = ok ? "PASS" : "FAIL"
  console.log(`[${tag}] ${step}${detail ? " — " + detail : ""}`)
}

async function waitForReady(child) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastErr
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server process exited early (code ${child.exitCode}) before becoming ready`)
    }
    try {
      const res = await fetch(`${BASE_URL}/api/vault/list`)
      // Any HTTP response (even a 500) means the server is up and the route
      // compiled — readiness, not correctness. Step 1's own assertions check
      // correctness.
      if (res) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS))
  }
  throw new Error(
    `server did not become ready within ${READY_TIMEOUT_MS}ms (last error: ${lastErr?.message ?? "n/a"})`,
  )
}

async function step1_vaultScaffold(vaultDir) {
  try {
    const res = await fetch(`${BASE_URL}/api/vault/list`)
    if (!res.ok) {
      record("Step 1: GET /api/vault/list", false, `HTTP ${res.status}`)
      return
    }
    const body = await res.json()
    const paths = body.paths ?? []
    const missing = RESERVED_FILES.filter((f) => !paths.includes(f))
    if (missing.length > 0) {
      record("Step 1: GET /api/vault/list", false, `missing scaffolded files in response: ${missing.join(", ")}`)
      return
    }

    // Also verify directly on disk — proves the scaffold actually landed on
    // the filesystem, not just in an in-memory/mock storage.
    const missingOnDisk = RESERVED_FILES.filter((f) => !existsSync(join(vaultDir, f)))
    if (missingOnDisk.length > 0) {
      record("Step 1: disk scaffold", false, `missing on disk: ${missingOnDisk.join(", ")}`)
      return
    }

    record("Step 1: vault scaffold (API + disk)", true, `paths=[${paths.join(", ")}]`)
  } catch (err) {
    record("Step 1: GET /api/vault/list", false, err instanceof Error ? err.message : String(err))
  }
}

async function step2_vaultFileRoundtrip(vaultDir) {
  const relPath = "wiki/_gate_probe.md"
  try {
    const putRes = await fetch(`${BASE_URL}/api/vault/file?path=${encodeURIComponent(relPath)}`, {
      method: "PUT",
      headers: { "x-vault-text": "1" },
      body: "probe",
    })
    if (putRes.status !== 204) {
      record("Step 2: PUT /api/vault/file", false, `expected 204, got ${putRes.status}`)
      return
    }

    const getRes = await fetch(`${BASE_URL}/api/vault/file?path=${encodeURIComponent(relPath)}`)
    if (!getRes.ok) {
      record("Step 2: GET /api/vault/file", false, `HTTP ${getRes.status}`)
      return
    }
    const text = await getRes.text()
    if (text !== "probe") {
      record("Step 2: GET /api/vault/file", false, `expected "probe", got ${JSON.stringify(text)}`)
      return
    }

    const onDiskPath = join(vaultDir, relPath)
    if (!existsSync(onDiskPath)) {
      record("Step 2: disk verification", false, `${onDiskPath} does not exist`)
      return
    }
    const onDiskText = readFileSync(onDiskPath, "utf8")
    if (onDiskText !== "probe") {
      record("Step 2: disk verification", false, `expected "probe" on disk, got ${JSON.stringify(onDiskText)}`)
      return
    }

    record("Step 2: vault file API <-> disk round-trip", true, onDiskPath)
  } catch (err) {
    record("Step 2: vault file round-trip", false, err instanceof Error ? err.message : String(err))
  }
}

async function step3_settingsKeyHygiene() {
  try {
    const patch = {
      keys: { openai: SETTINGS_API_KEY },
      baseUrls: { openai: SETTINGS_BASE_URL },
      tierModels: {
        strong: { provider: "openai", model: SETTINGS_MODEL },
        fast: { provider: "openai", model: SETTINGS_MODEL },
      },
      dailyBudgetUsd: 5,
    }

    const putRes = await fetch(`${BASE_URL}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch }),
    })
    if (!putRes.ok) {
      record("Step 3: PUT /api/settings", false, `HTTP ${putRes.status}`)
      return
    }
    const putRaw = await putRes.text()
    if (putRaw.includes(SETTINGS_API_KEY)) {
      record("Step 3: PUT /api/settings response leaks raw key", false, "raw key string found in PUT response body")
      return
    }

    const getRes = await fetch(`${BASE_URL}/api/settings`)
    if (!getRes.ok) {
      record("Step 3: GET /api/settings", false, `HTTP ${getRes.status}`)
      return
    }
    const getRaw = await getRes.text()
    if (getRaw.includes(SETTINGS_API_KEY)) {
      record("Step 3: GET /api/settings leaks raw key", false, "raw key string found in GET response body")
      return
    }
    const getBody = JSON.parse(getRaw)
    const openaiKeyEntry = getBody?.settings?.keys?.openai
    if (!openaiKeyEntry || openaiKeyEntry.present !== true) {
      record("Step 3: GET /api/settings redaction shape", false, `expected {present:true}, got ${JSON.stringify(openaiKeyEntry)}`)
      return
    }

    // Keys must also be unreachable via the generic vault file API.
    const vaultFileRes = await fetch(
      `${BASE_URL}/api/vault/file?path=${encodeURIComponent(".scispark/settings.json")}`,
    )
    if (vaultFileRes.status !== 403) {
      record("Step 3: settings.json unreachable via vault API", false, `expected 403, got ${vaultFileRes.status}`)
      return
    }

    record("Step 3: settings key hygiene (redacted GET, no raw key, vault API blocked)", true)
  } catch (err) {
    record("Step 3: settings key hygiene", false, err instanceof Error ? err.message : String(err))
  }
}

/** Loosely mirrors TrendingSurveySchema from src/lib/skills/trending.ts without
 * importing the TS module from this plain Node script. */
function looksLikeValidSurvey(survey) {
  if (!survey || typeof survey !== "object") return false
  const notable = survey.notablePapers
  const emerging = survey.emergingTopics
  return (
    Array.isArray(notable) &&
    notable.length >= 1 &&
    notable.length <= 6 &&
    notable.every((p) => typeof p?.title === "string" && p.title.length > 0 && typeof p?.why === "string" && p.why.length > 0) &&
    Array.isArray(emerging) &&
    emerging.length >= 1 &&
    emerging.length <= 5 &&
    typeof survey.momentum === "string" &&
    survey.momentum.length > 0
  )
}

async function step4_trendingRefresh() {
  if (!HAS_LIVE_LLM) {
    console.log(
      "[SKIP] Step 4: POST /api/skills/trending/refresh — LIVE_LLM_BASE_URL/LIVE_LLM_MODEL/LIVE_LLM_API_KEY not all set; this is expected for the keyless smoke-test run.",
    )
    return
  }

  try {
    const field = { slug: "natural-language-processing", label: "Natural Language Processing" }
    const res = await fetch(`${BASE_URL}/api/skills/trending/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: [field] }),
    })
    if (!res.ok || !res.body) {
      record("Step 4: POST /api/skills/trending/refresh", false, `HTTP ${res.status}, body present=${Boolean(res.body)}`)
      return
    }

    let buffer = ""
    let progressCount = 0
    let terminal = null
    for await (const chunk of res.body) {
      buffer += Buffer.from(chunk).toString("utf8")
      let idx
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (line.trim().length === 0) continue
        const event = JSON.parse(line)
        if (event.type === "progress") {
          progressCount += 1
          console.log(`  [ndjson] progress: field=${event.field}`)
        } else if (event.type === "result" || event.type === "error") {
          terminal = event
        }
      }
    }

    if (!terminal) {
      record("Step 4: trending refresh NDJSON stream", false, "stream ended without a terminal result/error line")
      return
    }
    if (terminal.type === "error") {
      record("Step 4: trending refresh NDJSON stream", false, `terminal error: ${terminal.message}`)
      return
    }

    const dashboard = terminal.payload
    const panel = dashboard?.panels?.[0]
    if (!panel) {
      record("Step 4: trending refresh result shape", false, "no panels[0] in result payload")
      return
    }

    const weeklyVolumeOk = Array.isArray(panel.metrics?.weeklyVolume) && panel.metrics.weeklyVolume.length === 8
    const paperCountOk = typeof panel.metrics?.paperCountRecent === "number"
    if (!weeklyVolumeOk || !paperCountOk) {
      record(
        "Step 4: trending refresh metrics",
        false,
        `weeklyVolume=${JSON.stringify(panel.metrics?.weeklyVolume)} paperCountRecent=${JSON.stringify(panel.metrics?.paperCountRecent)}`,
      )
      return
    }

    const surveyOk = panel.survey === null || looksLikeValidSurvey(panel.survey)
    if (!surveyOk) {
      record("Step 4: trending refresh survey shape", false, `survey did not match expected schema: ${JSON.stringify(panel.survey)}`)
      return
    }
    if (panel.survey === null && !panel.error) {
      record("Step 4: trending refresh survey shape", false, "survey is null but panel.error is empty")
      return
    }

    console.log(`  [result] progressEvents=${progressCount} weeklyVolume=${JSON.stringify(panel.metrics.weeklyVolume)}`)
    console.log(`  [result] paperCountRecent=${panel.metrics.paperCountRecent}`)
    console.log(`  [result] survey=${panel.survey ? "schema-ok" : `null (error: ${panel.error})`}`)

    // Cost lives on the trending_refresh Tier-1 event, not on the result
    // payload itself — read it back from .scispark/events/<current-month>.jsonl
    // via the vault file API (per src/lib/events/log.ts's monthFilePath).
    try {
      const now = new Date()
      const monthFile = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
      const eventsPath = `.scispark/events/${monthFile}.jsonl`
      const eventsRes = await fetch(`${BASE_URL}/api/vault/file?path=${encodeURIComponent(eventsPath)}`)
      if (eventsRes.ok) {
        const raw = await eventsRes.text()
        const lines = raw.split("\n").filter((l) => l.trim().length > 0)
        const refreshEvents = lines
          .map((l) => {
            try {
              return JSON.parse(l)
            } catch {
              return null
            }
          })
          .filter((e) => e && e.type === "trending_refresh")
        const last = refreshEvents[refreshEvents.length - 1]
        if (last) {
          console.log(`  [cost] trending_refresh event costUsd=$${Number(last.costUsd ?? 0).toFixed(4)}`)
        } else {
          console.log("  [cost] no trending_refresh event found in current month's log (non-fatal)")
        }
      } else {
        console.log(`  [cost] could not read events file (HTTP ${eventsRes.status}, non-fatal)`)
      }
    } catch (err) {
      console.log(`  [cost] error reading cost from events log (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
    }

    record("Step 4: trending refresh (real search + real LLM)", true)
  } catch (err) {
    record("Step 4: trending refresh", false, err instanceof Error ? err.message : String(err))
  }
}

async function main() {
  const vaultDir = mkdtempSync(join(tmpdir(), "scispark-live-gate-"))
  // Next's dev-server lockfile lives under `distDir` (default `.next`), keyed
  // by directory, not port — two `next dev` processes for the same project
  // directory collide ("Another next dev server is already running") even on
  // different ports unless they use different distDirs. We give this scratch
  // run its own distDir (relative — Next joins distDir under the project
  // root regardless of whether an absolute path is passed, so this must be a
  // subfolder name, not an os.tmpdir() path) via next.config.ts's
  // SCISPARK_LIVE_GATE_DIST_DIR opt-in, and remove it in the finally block so
  // this script leaves no build artifacts behind.
  const relativeDistDir = `.next-live-gate-${process.pid}`
  const distDirAbs = join(REPO_ROOT, relativeDistDir)
  console.log(`[setup] scratch vault dir: ${vaultDir}`)
  console.log(`[setup] scratch distDir: ${relative(REPO_ROOT, distDirAbs)} (isolates this run's dev-server lock)`)
  console.log(`[setup] port: ${PORT}`)
  console.log(`[setup] LIVE_LLM_* present: ${HAS_LIVE_LLM}`)

  // `next dev` self-mutates the tracked `tsconfig.json` on startup, appending
  // `include` entries that point at this run's distDir's generated `.d.ts`
  // routes (`.next-live-gate-<pid>/{types,dev/types}/**/*.ts`). Since the
  // distDir name is per-run (PID-scoped, so concurrent runs never collide on
  // the dev-server lockfile), leaving that untouched would permanently dirty
  // a tracked file with a stale path on every single run. Snapshot it before
  // spawning and restore verbatim in the finally block regardless of outcome.
  const tsconfigPath = join(REPO_ROOT, "tsconfig.json")
  const tsconfigOriginal = existsSync(tsconfigPath) ? readFileSync(tsconfigPath, "utf8") : null

  let child
  try {
    child = spawn(NEXT_BIN, ["dev", "-p", String(PORT)], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SCISPARK_VAULT: vaultDir,
        PORT: String(PORT),
        SCISPARK_LIVE_GATE_DIST_DIR: relativeDistDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let serverLog = ""
    child.stdout.on("data", (d) => {
      serverLog += d.toString()
    })
    child.stderr.on("data", (d) => {
      serverLog += d.toString()
    })

    let readyErr = null
    try {
      await waitForReady(child)
      console.log("[setup] dev server is ready")
    } catch (err) {
      readyErr = err
      console.error("[setup] dev server failed to become ready. Recent server output:")
      console.error(serverLog.slice(-4000))
    }

    if (readyErr) {
      record("Server startup", false, readyErr.message)
    } else {
      await step1_vaultScaffold(vaultDir)
      await step2_vaultFileRoundtrip(vaultDir)
      await step3_settingsKeyHygiene()
      await step4_trendingRefresh()
    }
  } finally {
    if (child && child.exitCode === null) {
      console.log("[teardown] killing dev server")
      try {
        if (process.platform !== "win32") {
          process.kill(-child.pid, "SIGTERM")
        } else {
          child.kill("SIGTERM")
        }
      } catch (err) {
        console.warn("[teardown] failed to kill child process group, trying direct kill:", err instanceof Error ? err.message : err)
        try {
          child.kill("SIGTERM")
        } catch {
          // best effort
        }
      }
      // Give it a moment to exit gracefully before the process ends.
      await new Promise((r) => setTimeout(r, 500))
    }
    try {
      rmSync(vaultDir, { recursive: true, force: true })
      console.log(`[teardown] removed scratch vault dir: ${vaultDir}`)
    } catch (err) {
      console.warn("[teardown] failed to remove scratch vault dir:", err instanceof Error ? err.message : err)
    }
    try {
      rmSync(distDirAbs, { recursive: true, force: true })
      console.log(`[teardown] removed scratch distDir: ${distDirAbs}`)
    } catch (err) {
      console.warn("[teardown] failed to remove scratch distDir:", err instanceof Error ? err.message : err)
    }
    try {
      if (tsconfigOriginal !== null) {
        const current = readFileSync(tsconfigPath, "utf8")
        if (current !== tsconfigOriginal) {
          writeFileSync(tsconfigPath, tsconfigOriginal)
          console.log("[teardown] restored tsconfig.json (next dev appends distDir-specific include paths on startup)")
        }
      }
    } catch (err) {
      console.warn("[teardown] failed to restore tsconfig.json:", err instanceof Error ? err.message : err)
    }
  }

  console.log("\n=== SUMMARY ===")
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}${r.detail ? " — " + r.detail : ""}`)
  }
  if (!HAS_LIVE_LLM) {
    console.log("SKIP  Step 4: trending refresh (no LIVE_LLM_* env — keyless smoke-test run)")
  }
  console.log(overallOk ? "\nOVERALL: PASS" : "\nOVERALL: FAIL")

  process.exit(overallOk ? 0 : 1)
}

main().catch((err) => {
  console.error("[fatal]", err)
  process.exit(1)
})
