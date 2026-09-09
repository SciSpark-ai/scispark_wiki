"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/Button"
import type { PaperSourceStatus, SourceConnectionResult } from "@/lib/papers/source-settings-types"
import { PAPER_SOURCE_IDS } from "@/lib/papers/source-settings-types"
import type { SourceId } from "@/lib/papers/types"
import { PaperSourceSelection } from "./PaperSourceSelection"

const ENDPOINT = "/api/settings/paper-sources"

export function PaperSourcesCard() {
  const [status, setStatus] = useState<PaperSourceStatus | null>(null)
  const [sources, setSources] = useState<SourceId[]>([...PAPER_SOURCE_IDS])
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<"save" | "remove" | "test" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(ENDPOINT, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        if (!response.ok) throw new Error("load failed")
        const body = await response.json()
        if (!controller.signal.aborted) { setStatus(body.s2); setSources(body.enabledSources ?? [...PAPER_SOURCE_IDS]) }
      })
      .catch(() => { if (!controller.signal.aborted) setError("Paper source settings could not be loaded. Please retry.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload])

  async function act(action: "connect" | "remove") {
    if (inFlight.current) return
    const key = draft.trim()
    const shouldSave = action === "connect" && key.length > 0
    if (action === "connect" && !shouldSave && status?.mode !== "authenticated") return
    if (shouldSave && !/^[!-~]{1,2048}$/.test(key)) {
      setError("Paste a Semantic Scholar API key without spaces or line breaks.")
      return
    }
    inFlight.current = true
    let phase: "save" | "remove" | "test" = action === "remove" ? "remove" : shouldSave ? "save" : "test"
    setBusy(phase)
    setNotice(null)
    setError(null)
    try {
      if (phase !== "test") {
        const response = await fetch(ENDPOINT, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: action === "remove" ? null : key }),
          signal: AbortSignal.timeout(25_000),
        })
        if (!response.ok) throw new Error("save failed")
        const next: PaperSourceStatus = (await response.json()).s2
        setStatus(next)
        setDraft("") // Never retain or rehydrate a saved credential in the form.
        if (action === "remove") {
          setNotice(next.keySource === "environment"
            ? "Saved key removed. The server environment key is now in use."
            : "Saved key removed. Semantic Scholar requests are now anonymous.")
          return
        }
      }
      // Test only after a confirmed save. A failed probe never rolls back the
      // key, and a retry with an empty field tests the existing saved key.
      phase = "test"
      setBusy(phase)
      const response = await fetch(`${ENDPOINT}/test-connection`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        signal: AbortSignal.timeout(25_000),
      })
      if (!response.ok) throw new Error("test failed")
      const result: SourceConnectionResult = (await response.json()).result
      if (result.outcome === "ok") setNotice(result.message)
      else setError(result.message)
    } catch {
      setError(phase === "test"
        ? "The connection test could not complete. Your saved key is unchanged. Try again later."
        : "Could not confirm the settings change. Reopen Paper sources to check before retrying.")
    } finally { inFlight.current = false; setBusy(null) }
  }

  return (
    <section className="space-y-6" aria-labelledby="paper-sources-heading">
      <div className="space-y-2">
        <h2 id="paper-sources-heading" className="font-heading text-xl text-espresso">Paper sources</h2>
        <p className="text-[13px] leading-relaxed text-secondary-dark">
          Choose where Sparky looks for research.
        </p>
      </div>
      {loading ? <p role="status" className="text-[13px] text-muted-text">Loading paper sources…</p> : status && (
        <>
        <PaperSourceSelection initialSources={sources} />
        <div className="space-y-5 border-t border-border-warm pt-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-medium text-espresso">Semantic Scholar</h3>
              <span className="rounded-pill bg-card-surface px-3 py-1 text-[12px] text-secondary-dark">
                {status.mode === "authenticated" ? "API key configured" : "Anonymous access"}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-secondary-dark">
              {status.mode === "authenticated"
                ? `Authenticated requests · ${status.keySource === "vault" ? "key saved in this vault" : "using the server environment key"}.`
                : <><span className="block">Anonymous access uses a shared quota.</span><span className="block">Your own key gives you a separate quota.</span></>}
            </p>
          </div>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void act("connect") }}>
            <label className="block space-y-2 text-[13px] text-espresso">
              <span>Semantic Scholar API key</span>
              <input
                type="password" required={status.mode !== "authenticated"} autoComplete="off" spellCheck={false} autoCapitalize="none"
                value={draft} onChange={(event) => { setDraft(event.target.value); setNotice(null); setError(null) }}
                placeholder={status.savedKeyPresent ? "Enter a replacement key" : "Paste your Semantic Scholar key"}
                maxLength={2048} disabled={busy !== null}
                className="w-full rounded-btn border border-border-warm bg-light-surface px-3 py-2.5 text-espresso placeholder:text-muted-text focus:outline-none focus:ring-2 focus:ring-orange"
                aria-describedby="source-key-privacy"
              />
            </label>
            <p id="source-key-privacy" className="text-[12px] leading-relaxed text-muted-text">
              Your key is saved locally on this device.
            </p>
            <details className="text-[12px] leading-relaxed text-muted-text">
              <summary className="w-fit cursor-pointer rounded text-secondary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange">
                Storage &amp; privacy
              </summary>
              <p className="mt-2">
                <span className="block">Your key is stored in your vault without encryption.</span>
                <span className="block">It is not included in vault exports.</span>
              </p>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={(!draft.trim() && status.mode !== "authenticated") || busy !== null}>
                {busy === "save" ? "Saving…" : busy === "test" ? "Testing connection…"
                  : draft.trim() || status.mode !== "authenticated" ? "Save & test connection" : "Test connection"}
              </Button>
              {status.savedKeyPresent && <Button variant="quiet" disabled={busy !== null} onClick={() => void act("remove")}>{busy === "remove" ? "Removing…" : "Remove saved key"}</Button>}
            </div>
            {busy === "test" && <p role="status" className="text-[13px] text-secondary-dark">Checking a public search with your saved key. Pacing and retries can take up to 20 seconds. No AI calls.</p>}
          </form>
          <p className="text-[13px] leading-relaxed text-secondary-dark">
            <a href="https://www.semanticscholar.org/product/api" target="_blank" rel="noopener noreferrer" className="text-orange underline underline-offset-4">Request a Semantic Scholar key</a>.
            <span className="block">Optional. Other paper sources work without it.</span>
          </p>
        </div>
        </>
      )}
      {notice && <p role="status" className="text-[13px] leading-relaxed text-secondary-dark">{notice}</p>}
      {error && <div role="alert" className="space-y-3 text-[13px] leading-relaxed text-espresso">
        <p>{error}</p>
        {!status && !loading && <Button variant="secondary" onClick={() => { setError(null); setLoading(true); setReload((value) => value + 1) }}>Retry</Button>}
      </div>}
    </section>
  )
}
