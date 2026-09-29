import { join } from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { defineConfig, devices } from "@playwright/test"

const runDir = process.env.SCISPARK_E2E_RUN_DIR
const appPort = Number(process.env.SCISPARK_E2E_APP_PORT)
const llmPort = Number(process.env.SCISPARK_E2E_LLM_PORT)
const distDir = process.env.SCISPARK_E2E_DIST_DIR
const serverMode = process.env.SCISPARK_E2E_SERVER_MODE

if (!runDir || !Number.isInteger(appPort) || !Number.isInteger(llmPort) || !distDir || (serverMode !== "dev" && serverMode !== "start")) {
  throw new Error("Run Playwright through `npm run e2e` so it receives a disposable vault and isolated ports.")
}

const baseURL = `http://127.0.0.1:${appPort}`
const vaultPath = join(runDir, "vault")
process.env.SCISPARK_E2E_VAULT_PATH = vaultPath

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: join(runDir, "browser-session.json"),
    extraHTTPHeaders: { "x-scispark-profile": createHash("sha256").update(join(realpathSync(runDir), "vault")).digest("hex").slice(0, 32) },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node e2e/fixtures/mock-llm-server.mjs",
      url: `http://127.0.0.1:${llmPort}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { SCISPARK_E2E_LLM_PORT: String(llmPort) },
    },
    {
      command: `node node_modules/next/dist/bin/next ${serverMode} --hostname 127.0.0.1 --port ${appPort}`,
      url: `${baseURL}/api/local-profiles/session`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        SCISPARK_VAULT: vaultPath,
        SCISPARK_PROFILES_DIR: join(runDir, "profiles"),
        SCISPARK_LIVE_GATE_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
})
