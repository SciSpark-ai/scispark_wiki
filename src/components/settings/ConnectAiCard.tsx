"use client"

import { useEffect, useState } from "react"
import { Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle } from "lucide-react"
import { loadRedactedSettings, patchSettings } from "@/lib/llm/settings-client"
import type { ProviderId } from "@/lib/llm/types"

/**
 * A guided BYOK connection preset. Picking a named provider fills in its
 * provider slot and sensible default fast/strong model names, so a user only
 * has to paste a key. The "Other" preset targets any OpenAI-compatible endpoint
 * — it surfaces a Server URL and Model field so a key from any such service can
 * be used without hard-coding that service into the UI.
 */
interface Preset {
  id: string
  label: string
  blurb: string
  provider: ProviderId
  /** OpenAI-compatible base URL; "" means the provider's default endpoint. */
  baseUrl: string
  fastModel: string
  strongModel: string
  /** Omitted for "Other" — a custom endpoint has no canonical key page. */
  keyUrl?: string
  keyLabel?: string
  /** True for the generic OpenAI-compatible option (user supplies URL + model). */
  custom?: boolean
}

const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    blurb: "Claude, direct from Anthropic.",
    provider: "anthropic",
    baseUrl: "",
    fastModel: "claude-haiku-4-5",
    strongModel: "claude-sonnet-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "console.anthropic.com",
  },
  {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT models, direct from OpenAI.",
    provider: "openai",
    baseUrl: "",
    fastModel: "gpt-4o-mini",
    strongModel: "gpt-4o",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "platform.openai.com",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    blurb: "One key, many models.",
    provider: "openrouter",
    baseUrl: "",
    fastModel: "anthropic/claude-3.5-haiku",
    strongModel: "anthropic/claude-sonnet-5",
    keyUrl: "https://openrouter.ai/keys",
    keyLabel: "openrouter.ai",
  },
  {
    id: "google",
    label: "Google",
    blurb: "Gemini, from Google AI Studio.",
    provider: "google",
    baseUrl: "",
    fastModel: "gemini-2.0-flash",
    strongModel: "gemini-2.5-pro",
    keyUrl: "https://aistudio.google.com/apikey",
    keyLabel: "aistudio.google.com",
  },
  {
    id: "other",
    label: "Other",
    blurb: "Any OpenAI-compatible service — enter its server URL and model below.",
    provider: "openai",
    baseUrl: "",
    fastModel: "",
    strongModel: "",
    custom: true,
  },
]

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; ms: number; costUsd: number }
  | { status: "error"; message: string }

const inputClass =
  "w-full bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"

/** Providers often return their error wrapped as JSON (e.g. `{"error":"..."}`).
 * Unwrap it to the human sentence so the connection test doesn't show raw JSON. */
function friendlyError(message: string): string {
  const trimmed = message.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown }
      const inner = parsed.error ?? parsed.message
      if (typeof inner === "string" && inner.trim()) return inner.trim()
    } catch {
      /* not JSON — show as-is */
    }
  }
  return trimmed
}

/** Match a saved config back to a preset so the picker reflects reality on load.
 * A custom OpenAI-compatible base URL (openai provider + non-default endpoint)
 * maps to the generic "Other" option rather than any named service. */
function inferPresetId(provider: ProviderId, baseUrl: string): string {
  if (provider === "openai" && baseUrl.trim()) return "other"
  const direct = PRESETS.find((p) => p.provider === provider && !p.custom && p.baseUrl === "")
  return direct?.id ?? "anthropic"
}

export function ConnectAiCard() {
  const [loaded, setLoaded] = useState(false)
  const [presetId, setPresetId] = useState<string>("anthropic")
  const [fastModel, setFastModel] = useState("")
  const [strongModel, setStrongModel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [test, setTest] = useState<TestState>({ status: "idle" })

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const isCustom = !!preset.custom

  useEffect(() => {
    ;(async () => {
      try {
        const s = await loadRedactedSettings()
        const provider = s.tierModels.strong.provider
        const savedBaseUrl = s.baseUrls?.openai ?? ""
        const id = inferPresetId(provider, savedBaseUrl)
        setPresetId(id)
        setFastModel(s.tierModels.fast.model)
        setStrongModel(s.tierModels.strong.model)
        setBaseUrl(provider === "openai" ? savedBaseUrl : s.baseUrls?.openrouter ?? "")
        setKeySaved(!!s.keys[provider]?.present)
      } catch {
        // Fall back to the first preset's defaults if settings can't be read.
        applyPreset(PRESETS[0])
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  function applyPreset(p: Preset) {
    setPresetId(p.id)
    setFastModel(p.fastModel)
    setStrongModel(p.strongModel)
    setBaseUrl(p.baseUrl)
    setAdvancedOpen(false)
    setTest({ status: "idle" })
  }

  /** In "Other" mode a single Model field drives both tiers; Advanced can split. */
  function setModel(value: string) {
    setStrongModel(value)
    setFastModel(value)
  }

  async function handleSaveAndTest() {
    setSaving(true)
    setTest({ status: "idle" })
    try {
      await patchSettings({
        tierModels: {
          fast: { provider: preset.provider, model: fastModel.trim() },
          strong: { provider: preset.provider, model: strongModel.trim() },
        },
        baseUrls: {
          // Only a custom "Other" endpoint carries a base-URL override; named
          // providers always use their default endpoint (sent as "" to clear
          // any prior override).
          openai: preset.provider === "openai" && isCustom ? baseUrl.trim() : "",
          openrouter: "",
        },
        ...(apiKey.trim() ? { keys: { [preset.provider]: apiKey.trim() } } : {}),
      })
      if (apiKey.trim()) {
        setKeySaved(true)
        setApiKey("")
      }
    } catch (err) {
      setSaving(false)
      setTest({ status: "error", message: friendlyError(err instanceof Error ? err.message : String(err)) })
      return
    }
    // Ping the just-saved config through the server so the user sees whether
    // their key actually works, with round-trip latency.
    setTest({ status: "testing" })
    const started = Date.now()
    try {
      const res = await fetch("/api/skills/debug/ping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "ping" }),
      })
      const body = (await res.json().catch(() => null)) as
        | { result?: { status: string; error?: string; costUsd?: number } }
        | { error?: string }
        | null
      const result = body && "result" in body ? body.result : undefined
      if (!res.ok || !result || result.status !== "ok") {
        const message =
          result?.error ??
          (body && "error" in body ? body.error : undefined) ??
          `Request failed (${res.status})`
        setTest({ status: "error", message: friendlyError(message ?? "Connection test failed") })
      } else {
        setTest({ status: "ok", ms: Date.now() - started, costUsd: result.costUsd ?? 0 })
      }
    } catch (err) {
      setTest({ status: "error", message: friendlyError(err instanceof Error ? err.message : String(err)) })
    } finally {
      setSaving(false)
    }
  }

  const connected = keySaved && test.status !== "error"
  const missingCustomFields = isCustom && (!baseUrl.trim() || !strongModel.trim())
  const saveDisabled = saving || (!apiKey.trim() && !keySaved) || missingCustomFields

  return (
    <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-[18px] text-espresso">Connect your AI</h2>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-pill text-[12px] font-medium ${
            connected
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-card-surface text-muted-text border border-border-warm/30"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-muted-text/50"}`} />
          {connected ? `Connected — ${preset.label}${strongModel ? ` · ${strongModel}` : ""}` : "Not connected"}
        </span>
      </div>
      <p className="text-[13px] text-muted-text mb-5">
        Your key is stored on this machine and never sent to the browser. SciSpark calls the provider
        directly — bring your own key.
      </p>

      {!loaded ? (
        <p className="text-[13px] text-muted-text">Loading…</p>
      ) : (
        <>
          {/* Provider preset picker */}
          <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-2">
            Provider
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                className={`px-3.5 py-2 rounded-[10px] text-[14px] transition-colors border ${
                  p.id === presetId
                    ? "bg-orange text-white border-orange font-medium"
                    : "bg-light-surface text-espresso border-border-warm/30 hover:border-orange/40"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted-text mb-5">
            {preset.blurb}{" "}
            {preset.keyUrl && (
              <a
                href={preset.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-orange hover:text-orange/80"
              >
                Get a key at {preset.keyLabel}
                <ExternalLink size={12} strokeWidth={2} />
              </a>
            )}
          </p>

          {/* Server URL — only for a custom OpenAI-compatible endpoint */}
          {isCustom && (
            <div className="mb-4">
              <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
                Server URL
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.your-provider.com/v1"
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} font-mono`}
              />
              <p className="text-[12px] text-muted-text mt-1">
                Your service&apos;s OpenAI-compatible base URL — usually ends in <code>/v1</code>.
              </p>
            </div>
          )}

          {/* API key */}
          <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
            API key
          </label>
          <div className="relative mb-1">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keySaved ? "•••• saved — paste a new key to replace" : "Paste your API key"}
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} pr-11 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide key" : "Show key"}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-text hover:text-espresso"
            >
              {showKey ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
            </button>
          </div>

          {isCustom ? (
            /* Custom endpoint: Model is a primary field (drives both tiers);
               Advanced lets a cheaper model handle the fast tier. */
            <>
              <div className="mt-4">
                <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
                  Model
                </label>
                <input
                  value={strongModel}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="the model id your service expects"
                  autoComplete="off"
                  spellCheck={false}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="text-[13px] text-muted-text hover:text-espresso mt-3 mb-1"
              >
                {advancedOpen ? "▾" : "▸"} Advanced — use a cheaper model for quick steps
              </button>
              {advancedOpen && (
                <div className="mb-2 pl-1">
                  <label className="block text-[12px] text-muted-text mb-1">Fast model (quick steps)</label>
                  <input
                    value={fastModel}
                    onChange={(e) => setFastModel(e.target.value)}
                    placeholder="defaults to the model above"
                    className={`${inputClass} font-mono`}
                  />
                </div>
              )}
            </>
          ) : (
            /* Named provider: models are pre-filled; Advanced lets you tweak. */
            <>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="text-[13px] text-muted-text hover:text-espresso mt-3 mb-1"
              >
                {advancedOpen ? "▾" : "▸"} Advanced — models
              </button>
              {advancedOpen && (
                <div className="space-y-3 mb-2 pl-1">
                  <div>
                    <label className="block text-[12px] text-muted-text mb-1">Strong model (analysis)</label>
                    <input value={strongModel} onChange={(e) => setStrongModel(e.target.value)} className={`${inputClass} font-mono`} />
                  </div>
                  <div>
                    <label className="block text-[12px] text-muted-text mb-1">Fast model (quick steps)</label>
                    <input value={fastModel} onChange={(e) => setFastModel(e.target.value)} className={`${inputClass} font-mono`} />
                  </div>
                </div>
              )}
            </>
          )}

          {/* Save & test */}
          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={handleSaveAndTest}
              disabled={saveDisabled}
              className="px-4 py-2 rounded-pill text-[14px] font-medium bg-orange text-white hover:bg-orange/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Saving…" : "Save & test connection"}
            </button>

            {test.status === "ok" && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-green-700">
                <Check size={15} strokeWidth={2.2} />
                Connected in {test.ms} ms{test.costUsd > 0 ? ` · ~$${test.costUsd.toFixed(4)}` : ""}
              </span>
            )}
            {test.status === "error" && (
              <span className="inline-flex items-start gap-1.5 text-[13px] text-red-600 max-w-[380px]">
                <AlertCircle size={15} strokeWidth={2} className="mt-0.5 shrink-0" />
                {test.message}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
