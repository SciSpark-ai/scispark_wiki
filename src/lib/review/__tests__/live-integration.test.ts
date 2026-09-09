/** Paid gate: shares the PRE-EXISTING cumulative $2 evaluation ledger. Never CI. */
import { it, expect } from "vitest"
import { open, readFile, realpath, unlink } from "node:fs/promises"
import { join } from "node:path"
import { NodeFsVaultStorage } from "@/lib/vault/node-fs-storage"
import { loadSettings } from "@/lib/llm/settings"
import { OpenAICompatProvider } from "@/lib/llm/providers/openai-compat"
import { matchesPrice, reserveTokenCost } from "@/lib/llm/scoped-pricing"
import { setServerVaultForTests } from "@/lib/server/vault"
import { EvaluationLedger } from "../evaluation-ledger"
import { createReview, loadReview, updateReview } from "../store"
import { actOnReview, waitForReview } from "../coordinator"
import { exportReview } from "../report"

it.skipIf(process.env.SCISPARK_REVIEW_INTEGRATION_APPROVED !== "2_USD_TOTAL")("runs the integrated review with real research/model calls under the shared remaining allowance", async () => {
  const root = await realpath(process.env.SCISPARK_REVIEW_EVAL_VAULT ?? "")
  if (root !== "/private/tmp/scispark-review-live-GWqrkU") throw new Error("Use the already approved evaluation ledger; do not reset the allowance")
  const lockPath = join(root, "evaluation.lock")
  const lock = await open(lockPath, "wx", 0o600)
  try {
    const ledgerStore = new NodeFsVaultStorage(root)
    const savedLedger = JSON.parse((await ledgerStore.read(".scispark/review-evaluation/allowance.json"))!)
    const ledger = await EvaluationLedger.open(ledgerStore, savedLedger.price)
    const configPath = process.env.SCISPARK_REVIEW_CONFIG_FILE
    if (!configPath || configPath.startsWith(root)) throw new Error("Explicit approved provider configuration required")
    const original = JSON.parse(await readFile(configPath, "utf8"))
    // Only normally configured credentials/model/source choices; no real profile,
    // notes, chat history or keys are copied onto evaluation storage.
    const config = JSON.stringify({ llm: { ...original.llm, dailyBudgetUsd: 5 }, paperSources: original.paperSources })
    class CredentialOverlay extends NodeFsVaultStorage {
      async read(path: string) { return path === ".scispark/settings.json" ? config : super.read(path) }
      async write(path: string, value: string) { if (path === ".scispark/settings.json") throw new Error("Credentials must remain in memory"); return super.write(path, value) }
    }
    const storage = new CredentialOverlay(join(root, "integration-v1"))
    setServerVaultForTests(storage)
    const settings = await loadSettings(storage)
    const target = { ...settings.tierModels.strong, baseUrl: settings.baseUrls?.openai ?? "" }
    if (!matchesPrice(savedLedger.price, target)) throw new Error("Configured model/endpoint changed")
    const boundedFetch: typeof fetch = async (input, init) => {
      if (String(input) !== `${savedLedger.price.baseUrl}/chat/completions` || init?.method !== "POST") throw new Error("Unexpected model request")
      const body = JSON.parse(String(init.body))
      if (body.model !== target.model || body.stream || !Number.isSafeInteger(body.max_completion_tokens)) throw new Error("Unbounded or changed model request")
      const ceiling = reserveTokenCost(Buffer.byteLength(String(init.body), "utf8") + 4096, body.max_completion_tokens, savedLedger.price.rates)
      const attempt = await ledger.reserve("integration-v1", ceiling)
      let settled = false
      try {
        const response = await fetch(input, init)
        const raw = await response.text()
        let data; try { data = JSON.parse(raw) } catch {}
        const u = data?.usage
        settled = true
        await ledger.settle(attempt, u ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens,
          ...(u.prompt_tokens_details?.cached_tokens != null ? { cachedInputTokens: u.prompt_tokens_details.cached_tokens } : {}),
          ...(u.completion_tokens_details?.reasoning_tokens != null ? { reasoningTokens: u.completion_tokens_details.reasoning_tokens } : {}) } : undefined)
        console.log(JSON.stringify({ attempt, httpStatus: response.status, finish: data?.choices?.[0]?.finish_reason, ...ledger.totals() }))
        return new Response(raw, { status: response.status, headers: { "content-type": "application/json" } })
      } catch { if (!settled) await ledger.settle(attempt); throw new Error("Provider attempt failed or the cumulative allowance could not be reconciled") }
    }
    const apiKey = settings.keys.openai
    if (!apiKey) throw new Error("The approved provider key is not configured")
    const provider = new OpenAICompatProvider("openai", apiKey, target.baseUrl, boundedFetch)
    const question = "In adult EEG, how do envelope reconstruction and temporal response functions differ for studying speech perception in noise, and what remains uncertain?"
    if (!(await storage.read("profile.md"))) await storage.write("profile.md", "# Profile\n\nSynthetic test researcher interested in adult EEG methods and study design. Include null and contradictory evidence.")
    let run = await createReview(storage, { sessionId: "integrated-adult-eeg", operationId: "integration-v1", question, sources: ["openalex"] })
    if (run.status === "completed" || run.status === "partial") { console.log(JSON.stringify({ status: run.status, ...ledger.totals() })); return }
    if (run.status === "awaiting-approval") run = await updateReview(storage, run.id, (r) => {
      r.brief.model.rates = savedLedger.price.rates; r.brief.limits.papers = 4
      r.brief.allowanceUsd = Math.min(1.20, ledger.totals().remainingUsd)
      r.brief.scope = "A concise bounded methods review. Compare assumptions, what each method measures, and limitations supported by the retrieved studies. Identify unresolved comparisons without claiming exhaustive coverage."
    })
    console.log(JSON.stringify({ run: run.id, status: run.status, ...ledger.totals() }))
    if (run.status !== "awaiting-approval") throw new Error("Existing integration attempt needs explicit inspection before resume")
    await actOnReview(storage, run.id, { action: "approve", revision: run.revision }, { provider })
    await waitForReview(storage, run.id)
    const result = await loadReview(storage, run.id)
    if (result.versions.length) await storage.write("acceptance-report.md", exportReview(result, result.versions.at(-1)!, "markdown"))
    console.log(JSON.stringify({ run: run.id, status: result.status, stage: result.stage, error: result.error, evidence: result.evidence.length, versions: result.versions.length, ...ledger.totals() }))
    expect(result.status).toBe("completed")
    expect(result.versions.at(-1)?.verification).toBe("checked-draft")
  } finally { setServerVaultForTests(null); await lock.close(); await unlink(lockPath) }
}, 1_200_000)
