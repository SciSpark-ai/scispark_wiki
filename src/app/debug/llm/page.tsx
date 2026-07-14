"use client"

import { useEffect, useState } from "react"
import { z } from "zod"
import { getVault } from "@/lib/vault/get-vault"
import { loadRedactedSettings, patchSettings, type RedactedSettings, type SettingsPatch } from "@/lib/llm/settings-client"
import type { ProviderId, Tier } from "@/lib/llm/types"
import { runSkill } from "@/lib/skills/runner"
import { defineSkill, type SkillRunResult } from "@/lib/skills/types"
import { Meter } from "@/lib/llm/metering"
import {
  loadCompanionSettings,
  saveCompanionSettings,
  DEFAULT_COMPANION_SETTINGS,
  SESSION_BUDGET,
  type Chattiness,
} from "@/lib/companion/settings"

const PROVIDERS: ProviderId[] = ["anthropic", "openai", "google", "openrouter"]
const TIERS: Tier[] = ["fast", "strong"]
const CHATTINESS_LEVELS: Chattiness[] = ["off", "low", "medium", "high"]

const pingSkill = defineSkill({
  name: "debug-ping",
  version: "1",
  run: async (ctx) =>
    (
      await ctx.llm("fast", {
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        maxTokens: 32,
      })
    ).text,
})

const structuredSchema = z.object({
  answer: z.string(),
  confidence: z.number(),
})

const structuredSkill = defineSkill({
  name: "debug-structured",
  version: "1",
  run: async (ctx) =>
    ctx.llmStructured(
      "fast",
      {
        messages: [
          {
            role: "user",
            content:
              "Give a JSON object with answer (a short string) and confidence (0-1 number) for: is water wet?",
          },
        ],
      },
      structuredSchema,
    ),
})

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2)
}

const EMPTY_REDACTED: RedactedSettings = {
  keys: {},
  tierModels: {
    fast: { provider: "anthropic", model: "claude-haiku-4-5" },
    strong: { provider: "anthropic", model: "claude-opus-4-8" },
  },
  dailyBudgetUsd: 5,
}

export default function LlmDebugPage() {
  // Keys arrive redacted ({present: true}) — the raw key string never
  // reaches this page. `keyEdits` holds only the providers the user has
  // actually typed into this session; on save it's sent as a patch where a
  // value replaces the stored key and "" deletes it. Untouched providers are
  // omitted from the patch, leaving their (unseen) stored value alone.
  const [settings, setSettings] = useState<RedactedSettings>(EMPTY_REDACTED)
  const [keyEdits, setKeyEdits] = useState<Partial<Record<ProviderId, string>>>({})
  const [loaded, setLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState("")

  const [pingResult, setPingResult] = useState<SkillRunResult<string> | null>(null)
  const [pingRunning, setPingRunning] = useState(false)

  const [structuredResult, setStructuredResult] = useState<SkillRunResult<
    z.infer<typeof structuredSchema>
  > | null>(null)
  const [structuredRunning, setStructuredRunning] = useState(false)

  const [spentTodayUsd, setSpentTodayUsd] = useState<number | null>(null)

  const [companionChattiness, setCompanionChattiness] = useState<Chattiness>(
    DEFAULT_COMPANION_SETTINGS.chattiness,
  )
  const [companionName, setCompanionName] = useState<string>(DEFAULT_COMPANION_SETTINGS.companionName)
  const [companionSaveStatus, setCompanionSaveStatus] = useState("")

  const refreshSpend = async () => {
    const vault = await getVault()
    const meter = new Meter(vault)
    setSpentTodayUsd(await meter.spentTodayUsd())
  }

  useEffect(() => {
    ;(async () => {
      const vault = await getVault()
      setSettings(await loadRedactedSettings())
      const companion = await loadCompanionSettings(vault)
      setCompanionChattiness(companion.chattiness)
      setCompanionName(companion.companionName)
      setLoaded(true)
      await refreshSpend()
    })()
  }, [])

  const handleSave = async () => {
    setSaveStatus("saving…")
    const patch: SettingsPatch = {
      tierModels: settings.tierModels,
      dailyBudgetUsd: settings.dailyBudgetUsd,
      // baseUrls isn't secret — the browser always knows the full desired
      // state, so send both providers explicitly ("" deletes an override
      // the user cleared locally).
      baseUrls: {
        openai: settings.baseUrls?.openai ?? "",
        openrouter: settings.baseUrls?.openrouter ?? "",
      },
    }
    if (Object.keys(keyEdits).length > 0) patch.keys = keyEdits
    const updated = await patchSettings(patch)
    setSettings(updated)
    setKeyEdits({})
    setSaveStatus(`saved ${new Date().toLocaleTimeString()}`)
  }

  const handleCompanionChattinessChange = async (value: Chattiness) => {
    setCompanionChattiness(value)
    setCompanionSaveStatus("saving…")
    const vault = await getVault()
    // Save the FULL CompanionSettings — must include companionName or this
    // handler would clobber whatever name the other handler last saved.
    await saveCompanionSettings(vault, { chattiness: value, companionName })
    setCompanionSaveStatus(`saved ${new Date().toLocaleTimeString()}`)
  }

  const handleCompanionNameSave = async () => {
    setCompanionSaveStatus("saving…")
    const vault = await getVault()
    // Save the FULL CompanionSettings — must include chattiness or this
    // handler would clobber whatever chattiness the other handler last saved.
    await saveCompanionSettings(vault, { chattiness: companionChattiness, companionName })
    setCompanionSaveStatus(`saved ${new Date().toLocaleTimeString()}`)
  }

  const handlePing = async () => {
    setPingRunning(true)
    setPingResult(null)
    try {
      const vault = await getVault()
      const run = await runSkill({ skill: pingSkill, input: undefined, storage: vault })
      setPingResult(run)
    } finally {
      setPingRunning(false)
      await refreshSpend()
    }
  }

  const handleStructured = async () => {
    setStructuredRunning(true)
    setStructuredResult(null)
    try {
      const vault = await getVault()
      const run = await runSkill({ skill: structuredSkill, input: undefined, storage: vault })
      setStructuredResult(run)
    } finally {
      setStructuredRunning(false)
      await refreshSpend()
    }
  }

  const updateKey = (provider: ProviderId, value: string) => {
    setKeyEdits((prev) => ({ ...prev, [provider]: value }))
  }

  const updateTierModel = (tier: Tier, field: "provider" | "model", value: string) => {
    setSettings((s) => ({
      ...s,
      tierModels: {
        ...s.tierModels,
        [tier]: { ...s.tierModels[tier], [field]: value },
      },
    }))
  }

  const remainingUsd =
    spentTodayUsd === null ? null : settings.dailyBudgetUsd - spentTodayUsd

  return (
    <div style={{ padding: 24, fontFamily: "monospace", maxWidth: 720 }}>
      <h1>LLM harness debug</h1>
      <p>Manual verification gate: settings → provider → runner → metering → budget.</p>

      {!loaded ? (
        <p>loading…</p>
      ) : (
        <>
          <h2>Settings</h2>

          <h3>API keys</h3>
          <p style={{ fontSize: 13, color: "#666" }}>
            Keys are stored server-side and never sent to the browser. A saved key shows as a
            placeholder below — type a new value to replace it, or Clear + Save to remove it.
          </p>
          {PROVIDERS.map((provider) => {
            const touched = provider in keyEdits
            const present = !!settings.keys[provider]?.present
            const willRemove = touched && keyEdits[provider] === ""
            return (
              <div key={provider} style={{ marginBottom: 8 }}>
                <label>
                  {provider}:{" "}
                  <input
                    type="password"
                    value={touched ? keyEdits[provider] ?? "" : ""}
                    onChange={(e) => updateKey(provider, e.target.value)}
                    placeholder={present && !touched ? "•••• saved" : "not set"}
                    style={{ width: 320 }}
                    autoComplete="off"
                  />
                </label>{" "}
                {present && !touched && (
                  <button onClick={() => updateKey(provider, "")}>Clear</button>
                )}
                {willRemove && (
                  <span style={{ marginLeft: 8, color: "#b45309" }}>will remove on save</span>
                )}
              </div>
            )
          })}

          <h3>Base URL overrides (OpenAI-compatible endpoints, e.g. GMI Cloud)</h3>
          {(["openai", "openrouter"] as const).map((provider) => (
            <div key={provider} style={{ marginBottom: 8 }}>
              <label>
                {provider} base URL:{" "}
                <input
                  type="text"
                  placeholder={provider === "openai" ? "https://api.gmi-serving.com/v1 (blank = api.openai.com)" : "blank = openrouter.ai"}
                  value={settings.baseUrls?.[provider] ?? ""}
                  onChange={(e) =>
                    setSettings((s) => {
                      const value = e.target.value.trim()
                      const baseUrls = { ...(s.baseUrls ?? {}) }
                      if (value) baseUrls[provider] = value
                      else delete baseUrls[provider]
                      return { ...s, ...(Object.keys(baseUrls).length ? { baseUrls } : { baseUrls: undefined }) }
                    })
                  }
                  style={{ width: 420 }}
                  autoComplete="off"
                />
              </label>
            </div>
          ))}

          <h3>Tier models</h3>
          {TIERS.map((tier) => (
            <div key={tier} style={{ marginBottom: 8 }}>
              <strong>{tier}</strong>{" "}
              <select
                value={settings.tierModels[tier].provider}
                onChange={(e) => updateTierModel(tier, "provider", e.target.value)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>{" "}
              <input
                type="text"
                value={settings.tierModels[tier].model}
                onChange={(e) => updateTierModel(tier, "model", e.target.value)}
                style={{ width: 240 }}
              />
            </div>
          ))}

          <h3>Daily budget (USD)</h3>
          <input
            type="number"
            step="0.01"
            value={settings.dailyBudgetUsd}
            onChange={(e) =>
              setSettings((s) => ({ ...s, dailyBudgetUsd: Number(e.target.value) }))
            }
            style={{ width: 120 }}
          />

          <div style={{ marginTop: 12 }}>
            <button onClick={handleSave}>Save</button> <span>{saveStatus}</span>
          </div>

          <hr style={{ margin: "24px 0" }} />

          <h2>Research Companion</h2>
          <p>
            Chattiness controls how often the companion proactively speaks up (M7). Each level caps
            proactive interventions per browser session; &quot;off&quot; silences proactivity entirely.
          </p>
          <div style={{ marginBottom: 8 }}>
            <label>
              Chattiness:{" "}
              <select
                value={companionChattiness}
                onChange={(e) => handleCompanionChattinessChange(e.target.value as Chattiness)}
              >
                {CHATTINESS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level} (max {SESSION_BUDGET[level]}/session)
                  </option>
                ))}
              </select>
            </label>{" "}
            <label>
              Name:{" "}
              <input
                type="text"
                value={companionName}
                maxLength={40}
                onChange={(e) => setCompanionName(e.target.value)}
                onBlur={handleCompanionNameSave}
                style={{ width: 160 }}
              />
            </label>{" "}
            <span>{companionSaveStatus}</span>
          </div>

          <hr style={{ margin: "24px 0" }} />

          <h2>Spend</h2>
          <p>
            spentTodayUsd:{" "}
            {spentTodayUsd === null ? "…" : spentTodayUsd.toFixed(4)} / dailyBudgetUsd:{" "}
            {settings.dailyBudgetUsd.toFixed(2)} (remaining:{" "}
            {remainingUsd === null ? "…" : remainingUsd.toFixed(4)})
          </p>
          <button onClick={refreshSpend}>Refresh spend</button>

          <hr style={{ margin: "24px 0" }} />

          <h2>Test completion</h2>
          <button onClick={handlePing} disabled={pingRunning}>
            {pingRunning ? "running…" : "Test completion"}
          </button>
          {pingResult && (
            <pre style={{ background: "#f0f0f0", padding: 12, overflowX: "auto" }}>
              {`status: ${pingResult.status}\n` +
                `output: ${pretty(pingResult.output)}\n` +
                `usage: ${pretty(pingResult.usage)}\n` +
                `costUsd: ${pingResult.costUsd}\n` +
                `error: ${pingResult.error ?? "(none)"}\n` +
                `logs:\n${pingResult.logs.join("\n")}`}
            </pre>
          )}

          <hr style={{ margin: "24px 0" }} />

          <h2>Test structured</h2>
          <button onClick={handleStructured} disabled={structuredRunning}>
            {structuredRunning ? "running…" : "Test structured"}
          </button>
          {structuredResult && (
            <pre style={{ background: "#f0f0f0", padding: 12, overflowX: "auto" }}>
              {`status: ${structuredResult.status}\n` +
                `value: ${pretty(structuredResult.output)}\n` +
                `usage: ${pretty(structuredResult.usage)}\n` +
                `costUsd: ${structuredResult.costUsd}\n` +
                `error: ${structuredResult.error ?? "(none)"}\n` +
                `logs:\n${structuredResult.logs.join("\n")}`}
            </pre>
          )}
        </>
      )}
    </div>
  )
}
