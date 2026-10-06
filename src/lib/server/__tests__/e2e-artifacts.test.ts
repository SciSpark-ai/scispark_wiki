// @vitest-environment node
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, it } from "vitest"

it.each(["relative-output", "/", tmpdir(), join(process.cwd(), "test-results"), join(process.cwd(), ".next-e2e")])("rejects unsafe artifact destination before starting any browser/server: %s", path => {
  const result = spawnSync(process.execPath, ["scripts/run-playwright.mjs"], { encoding: "utf8", env: { ...process.env, SCISPARK_E2E_PRODUCTION_DIST_DIR: "", SCISPARK_E2E_ARTIFACT_DIR: path } })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("Artifact output must be")
  expect(result.stdout).not.toContain("Running")
})

it("resolves symlink ancestors before accepting an output directory", () => {
  const root = mkdtempSync(join(tmpdir(), "scispark-artifact-check-"))
  const build = join(process.cwd(), ".next-e2e")
  // Link to the repository so no build directory or human files need be created.
  mkdirSync(join(root, "links"))
  symlinkSync(process.cwd(), join(root, "links", "repo"), "dir")
  try {
    const result = spawnSync(process.execPath, ["scripts/run-playwright.mjs"], { encoding: "utf8", env: { ...process.env, SCISPARK_E2E_PRODUCTION_DIST_DIR: "", SCISPARK_E2E_ARTIFACT_DIR: join(root, "links", "repo", build.split("/").at(-1)!, "inside") } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Artifact output must be outside")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
