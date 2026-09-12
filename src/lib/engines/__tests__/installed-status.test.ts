import { writeFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { localEngineStatus } from "../status"
// Read-only installed-runtime check. Never performs inference or exposes tokens.
it.skipIf(process.env.SCISPARK_ENGINE_STATUS_CHECK !== "1")("checks installed CLI versions and subscription login", async () => {
  const statuses = []
  for (const engine of ["codex", "claude-code"] as const) {
    const status = await localEngineStatus(engine)
    statuses.push(status)
    expect(["ready", "signed-out", "unavailable"]).toContain(status.state)
  }
  await writeFile("/tmp/scispark-engine-status.json", JSON.stringify(statuses, null, 2))
}, 45_000)
