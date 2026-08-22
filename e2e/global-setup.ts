import { NodeFsVaultStorage } from "../src/lib/vault/node-fs-storage"
import { openVault } from "../src/lib/vault/scaffold"
import { buildPaperPage, composePage } from "../src/lib/wiki/authoring"
import { saveSettings } from "../src/lib/llm/settings"

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
  await storage.write(paper.path, composePage(paper))

  await saveSettings(storage, {
    keys: { openai: "e2e-local-only-key" },
    tierModels: {
      fast: { provider: "openai", model: "gpt-5.4-mini" },
      strong: { provider: "openai", model: "gpt-5.4-mini" },
    },
    dailyBudgetUsd: 100,
    baseUrls: { openai: `http://127.0.0.1:${llmPort}/v1` },
  })
}
