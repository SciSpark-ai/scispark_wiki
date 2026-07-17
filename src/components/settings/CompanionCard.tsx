"use client"

import { useEffect, useState } from "react"
import { loadCompanionSettingsRemote, saveCompanionSettingsRemote } from "@/lib/companion/settings-client"
import {
  DEFAULT_COMPANION_SETTINGS,
  SESSION_BUDGET,
  type Chattiness,
} from "@/lib/companion/settings"

const CHATTINESS_LEVELS: Chattiness[] = ["off", "low", "medium", "high"]
const CHATTINESS_BLURB: Record<Chattiness, string> = {
  off: "Never speaks up on its own",
  low: "Occasional nudges",
  medium: "A balanced amount",
  high: "Chimes in often",
}

const inputClass =
  "w-full bg-light-surface border border-border-warm/30 rounded-[10px] px-3 py-2.5 text-[14px] text-espresso focus:outline-none focus:border-orange/50"

export function CompanionCard() {
  const [loaded, setLoaded] = useState(false)
  const [name, setName] = useState(DEFAULT_COMPANION_SETTINGS.companionName)
  const [chattiness, setChattiness] = useState<Chattiness>(DEFAULT_COMPANION_SETTINGS.chattiness)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const c = await loadCompanionSettingsRemote()
        setName(c.companionName)
        setChattiness(c.chattiness)
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  async function persist(next: { companionName: string; chattiness: Chattiness }) {
    setStatus("Saving…")
    setError(null)
    try {
      await saveCompanionSettingsRemote(next)
      setStatus("Saved")
      setTimeout(() => setStatus(null), 1500)
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="bg-light-surface rounded-[14px] border border-border-warm/30 p-6 mt-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-heading text-[18px] text-espresso">Research companion</h2>
        {status && <span className="text-[13px] text-muted-text">{status}</span>}
      </div>
      <p className="text-[13px] text-muted-text mb-5">
        Your companion greets you, celebrates ingests, and offers help while you read. Rename it, or
        dial how often it speaks up on its own.
      </p>

      {!loaded ? (
        <p className="text-[13px] text-muted-text">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Name
            </label>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => persist({ companionName: name, chattiness })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-[13px] text-muted-text font-medium uppercase tracking-[0.06em] mb-1.5">
              Chattiness
            </label>
            <select
              value={chattiness}
              onChange={(e) => {
                const value = e.target.value as Chattiness
                setChattiness(value)
                void persist({ companionName: name, chattiness: value })
              }}
              className={inputClass}
            >
              {CHATTINESS_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level} — {CHATTINESS_BLURB[level]} (max {SESSION_BUDGET[level]}/session)
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {error && <p className="mt-4 text-[13px] text-red-600">Couldn&apos;t save: {error}</p>}
    </div>
  )
}
