import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { openVault } from "../src/lib/vault/scaffold"
import { buildPaperPage, composePage } from "../src/lib/wiki/authoring"
import { saveSettings } from "../src/lib/llm/settings"
import { request } from "@playwright/test"
import { mkdir, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"

export default async function globalSetup(): Promise<void> {
  const vaultPath = process.env.SCISPARK_E2E_VAULT_PATH
  const llmPort = Number(process.env.SCISPARK_E2E_LLM_PORT)
  if (!vaultPath || !Number.isInteger(llmPort)) throw new Error("disposable E2E environment is missing")

  const storage = new NodeFsVaultStorage(vaultPath)
  await openVault(storage, {
    purpose: "Disposable SciSpark developer-preview acceptance vault.",
    now: () => new Date("2026-08-21T12:00:00.000Z"),
  })

  const paper = buildPaperPage(
    {
      ids: {},
      title: "E2E Grounding Paper",
      authors: [{ name: "Ada Researcher" }],
      abstract: "This disposable paper demonstrates grounded project retrieval and recovery.",
      year: 2026,
      venue: "SciSpark Preview",
      fields: ["Developer testing"],
      source: "s2",
    },
    { today: "2026-08-21", status: "saved", sources: ["e2e:seed"] },
  )
  if (process.env.SCISPARK_E2E_EMPTY_VAULT !== "1") await storage.write(paper.path, composePage(paper))

  await saveSettings(storage, {
    keys: { openai: "e2e-local-only-key" },
    tierModels: {
      fast: { provider: "openai", model: "gpt-5.4-mini" },
      strong: { provider: "openai", model: "gpt-5.4-mini" },
    },
    dailyBudgetUsd: 100,
    baseUrls: { openai: process.env.SCISPARK_E2E_MODULAR_FIXTURE === "1" ? "https://api.openai.com/v1" : `http://127.0.0.1:${llmPort}/v1` },
  })

  // Exercise the same local login as a user; no authentication bypass for E2E.
  const client = await request.newContext({ baseURL: `http://127.0.0.1:${process.env.SCISPARK_E2E_APP_PORT}` })
  try {
    const { profiles } = await (await client.get("/api/local-profiles")).json()
    const session = await client.post("/api/local-profiles/session", { data: { profileId: profiles[0].id } })
    if (!session.ok()) throw new Error("Could not open disposable E2E profile")
    if (process.env.SCISPARK_E2E_MODULAR_FIXTURE === "1") {
      const headers = { "x-scispark-profile": profiles[0].id }
      const library = (await (await client.get("/api/tools?view=library", { headers })).json()).result
      const runs = (await (await client.get("/api/tools/runs", { headers })).json()).result
      const root = join(process.env.SCISPARK_E2E_RUN_DIR!, "evidence"); await mkdir(root, { recursive: true })
      const provider = await readFile(join(root, "provider.jsonl"), "utf8").catch(() => "")
      await writeFile(join(root, "fresh-profile.json"), JSON.stringify({ enabled: library.tools.filter((tool: { enabled: boolean }) => tool.enabled), runs, providerCalls: provider.trim() ? provider.trim().split("\n").length : 0, vault: vaultPath, scheduler: "off" }, null, 2))
    }
    await client.storageState({ path: join(process.env.SCISPARK_E2E_RUN_DIR!, "browser-session.json") })
  } finally { await client.dispose() }
}
