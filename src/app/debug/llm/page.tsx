"use client"

import { useEffect, useState } from "react"
import { getVault } from "@/lib/vault/get-vault"
import { loadRedactedSettings, patchSettings, type RedactedSettings, type SettingsPatch } from "@/lib/llm/settings-client"
import type { ProviderId, Tier } from "@/lib/llm/types"
import type { SkillRunResult } from "@/lib/skills/types"
import type { DebugStructuredOutput } from "@/lib/skills/debug"
import { SpendPanel } from "@/components/settings/SpendPanel"
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

/**
 * POST /api/skills/debug/ping with `{kind}`; resolves with the raw
 * `SkillRunResult` (M11 Task 10 — the browser-purity gate forbids client
 * code from importing `runSkill`/`@/lib/skills/runner` directly, so the ping
 * and structured-output test buttons below now go through a tiny server
 * route instead of running the skill in-browser).
 */
async function runDebugSkill<O>(kind: "ping" | "structured"): Promise<SkillRunResult<O>> {
  const res = await fetch("/api/skills/debug/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  })
  if (!res.ok) {
    let message = `debug skill run failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) message = body.error
    } catch {
      /* non-JSON body; fall back to the generic status message */
    }
    throw new Error(message)
  }
  const body = (await res.json()) as { result: SkillRunResult<O> }
  return body.result
}

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

  const [structuredResult, setStructuredResult] = useState<SkillRunResult<DebugStructuredOutput> | null>(
    null,
  )
  const [structuredRunning, setStructuredRunning] = useState(false)

  const [companionChattiness, setCompanionChattiness] = useState<Chattiness>(
    DEFAULT_COMPANION_SETTINGS.chattiness,
  )
  const [companionName, setCompanionName] = useState<string>(DEFAULT_COMPANION_SETTINGS.companionName)
  const [companionSaveStatus, setCompanionSaveStatus] = useState("")

  useEffect(() => {
    ;(async () => {
      const vault = await getVault()
      setSettings(await loadRedactedSettings())
      const companion = await loadCompanionSettings(vault)
      setCompanionChattiness(companion.chattiness)
      setCompanionName(companion.companionName)
      setLoaded(true)
    })()
  }, [])

  const handleSave = async () => {
    setSaveStatus("saving…")
    const patch: SettingsPatch = {
      tierModels: settings.tierModels,
      // The daily budget is now edited in the SpendPanel below (its own
      // patchSettings call), so this combined save leaves it untouched.
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
      const run = await runDebugSkill<string>("ping")
      setPingResult(run)
    } finally {
      setPingRunning(false)
    }
  }

  const handleStructured = async () => {
    setStructuredRunning(true)
    setStructuredResult(null)
    try {
      const run = await runDebugSkill<DebugStructuredOutput>("structured")
      setStructuredResult(run)
    } finally {
      setStructuredRunning(false)
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

          <div style={{ marginTop: 12 }}>
            <button onClick={handleSave}>Save</button> <span>{saveStatus}</span>
          </div>
          <p style={{ fontSize: 13, color: "#666" }}>
            The daily budget is edited in the AI-spend panel below.
          </p>

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

          <SpendPanel />

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
