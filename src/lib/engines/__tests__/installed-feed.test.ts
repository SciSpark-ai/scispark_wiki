import { expect, test } from "vitest"
import { writeFile } from "node:fs/promises"
import { MemoryVaultStorage } from "../../vault/memory-storage"
import { DEFAULT_SETTINGS } from "../../llm/settings"
import { DEFAULT_ENGINES } from "../contracts"
import { runFeed, loadFeed } from "../../skills/feed"

test.skipIf(process.env.SCISPARK_CODEX_FEED_SMOKE !== "1")("installed Codex completes both feed stages with synthetic research", async () => {
  const storage = new MemoryVaultStorage()
  await storage.write("profile.md", "# Profile\n\n## Research fields\n\n- machine learning\n")
  await storage.write("interests.md", "# Interests\n\n## Active topics\n\n- sparse attention\n")
  await storage.write(".scispark/settings.json", JSON.stringify({ paperSources: { enabledSources: ["arxiv"] } }))
  const result = await runFeed(storage, {
    settings: { ...DEFAULT_SETTINGS, keys: {}, dailyBudgetUsd: 0, engines: { ...DEFAULT_ENGINES, kind: "codex", timeoutSeconds: 45 } },
    now: () => new Date("2026-09-10T12:00:00Z"),
    searchFn: async () => [{ title: "Sparse attention methods in transformer models", ids: { arxiv: "synthetic-test" }, authors: [], fields: [], source: "arxiv", date: "2026-09-10", abstract: "Sparse attention methods evaluated in transformer models. This is fictional test data." }],
  })
  const runs = await Promise.all((await storage.list(".scispark/runs/")).map(async p => JSON.parse((await storage.read(p))!)))
  const evidence = { status: result.recommendation?.status, ranked: result.stats.ranked, billingMode: result.billingMode, runs: runs.map(r => ({ skill:r.skill, status:r.status, error:r.error, usage:r.usage })) }
  await writeFile("/tmp/scispark-codex-feed-smoke.json", JSON.stringify(evidence,null,2), { mode:0o600 })
  expect(runs.map(r=>({skill:r.skill,status:r.status,error:r.error}))).toEqual(expect.arrayContaining([
    expect.objectContaining({ skill: "feed-strategy", status: "ok" }),
    expect.objectContaining({ skill: "recommendation-assessment", status: "ok" }),
  ]))
  expect(result.stats.ranked).toBe(1)
  expect(result.billingMode).toBe("subscription")
  expect((await loadFeed(storage))?.billingMode).toBe("subscription")
}, 110000)
