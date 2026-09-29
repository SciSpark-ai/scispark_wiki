"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { BrandLogo } from "@/components/brand/BrandLogo"
import { Button } from "@/components/ui/Button"
import type { LocalProfile } from "@/lib/local-profile-contract"
import { announceProfileChange, clearProfileBrowserState, createProfileFetch, PROFILE_CHANGED_KEY } from "@/lib/local-profile-client"

const LocalProfileContext = createContext<LocalProfile | null>(null)
export const useLocalProfile = () => useContext(LocalProfileContext)

async function json<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? "Please try again.")
  return data as T
}

function ProfileChooser() {
  const [profiles, setProfiles] = useState<LocalProfile[] | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/local-profiles", { signal: controller.signal }).then(json<{ profiles: LocalProfile[] }>).then((data) => setProfiles(data.profiles)).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load profiles")
    })
    return () => controller.abort()
  }, [])

  async function open(profile: LocalProfile, created = false) {
    await json(await fetch("/api/local-profiles/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: profile.id }) }))
    clearProfileBrowserState(profile.id)
    announceProfileChange()
    window.location.replace(created ? "/setup" : "/")
  }

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await work() }
    catch (err) { setError(err instanceof Error ? err.message : "Please try again."); setBusy(false) }
  }

  return (
    <main className="min-h-dvh bg-page-bg px-5 py-10 text-espresso sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <BrandLogo />
        <h1 className="mt-8 font-heading text-4xl">Choose your profile</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-text">One profile, one vault. Your papers, notes, chats, and AI settings stay together.</p>
        <div className="mt-7 space-y-3" aria-label="Local profiles">
          {profiles === null && !error && <p role="status" className="text-sm text-muted-text">Loading profiles…</p>}
          {profiles?.map((profile) => (
            <button key={profile.id} type="button" disabled={busy} onClick={() => void act(() => open(profile))} className="flex w-full items-center gap-4 rounded-card border border-border-warm bg-light-surface p-5 text-left transition-colors hover:bg-card-surface disabled:opacity-50 focus-visible:outline-accent-ink">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange text-on-accent">{profile.name.charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{profile.name}</span><span className="mt-1 block text-xs text-muted-text">Open vault</span></span>
              <span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
        <form className="mt-8 border-t border-border-warm pt-6" onSubmit={(event) => {
          event.preventDefault()
          void act(async () => {
            const data = await json<{ profile: LocalProfile }>(await fetch("/api/local-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }))
            // Keep the newly created profile visible if opening it fails; retry cannot create a duplicate.
            setProfiles((current) => [...(current ?? []), data.profile])
            setName("")
            await open(data.profile, true)
          })
        }}>
          <label htmlFor="local-profile-name" className="block text-sm font-medium">Create a new profile</label>
          <p className="mt-1 text-xs leading-relaxed text-muted-text">Start with an empty vault and connect your AI separately.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input id="local-profile-name" autoComplete="off" maxLength={80} required placeholder="Profile name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className="min-w-0 flex-1 rounded-lg border border-border-warm bg-light-surface px-4 py-2 text-sm focus:outline-accent-ink" />
            <Button type="submit" disabled={busy || !name.trim()}>Create profile</Button>
          </div>
        </form>
        {error && <p role="alert" className="mt-4 text-sm text-accent-ink">{error}</p>}
        {busy && <p role="status" className="mt-4 text-sm text-muted-text">Opening your vault…</p>}
        <p className="mt-8 text-xs leading-relaxed text-muted-text">Profiles are local to this computer and do not use passwords. Log out closes the profile; it does not lock or encrypt the files on disk.</p>
      </div>
    </main>
  )
}

export function ProfileGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "open" | "closed" | "error">("loading")
  const [activeProfile, setActiveProfile] = useState<LocalProfile | null>(null)
  useEffect(() => {
    const transport = window.fetch.bind(window)
    const controller = new AbortController()
    let restore = () => {}
    let current: string | null = null
    const reload = () => {
      setStatus("loading")
      controller.abort()
      window.location.replace("/")
    }
    const check = async () => {
      const data = await json<{ profile: LocalProfile | null }>(await transport("/api/local-profiles/session", { cache: "no-store", signal: controller.signal }))
      return data.profile
    }
    void check().then((profile) => {
      if (controller.signal.aborted) return
      clearProfileBrowserState(profile?.id ?? null)
      setActiveProfile(profile)
      if (profile) {
        current = profile.id
        const previous = window.fetch
        window.fetch = createProfileFetch(profile.id, transport, window.location.origin, reload, controller.signal)
        restore = () => { window.fetch = previous }
      }
      setStatus(profile ? "open" : "closed")
    }).catch(() => { if (!controller.signal.aborted) setStatus("error") })
    const changed = (event: StorageEvent) => { if (event.key === PROFILE_CHANGED_KEY) reload() }
    const focused = () => {
      void check().then((profile) => { if ((profile?.id ?? null) !== current) reload() }).catch(() => {
        if (!controller.signal.aborted) setStatus("error")
      })
    }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reload() }
    window.addEventListener("storage", changed)
    window.addEventListener("focus", focused)
    window.addEventListener("pageshow", restored)
    return () => {
      controller.abort(); restore()
      window.removeEventListener("storage", changed)
      window.removeEventListener("focus", focused)
      window.removeEventListener("pageshow", restored)
    }
  }, [])

  if (status === "open") return <LocalProfileContext.Provider value={activeProfile}>{children}</LocalProfileContext.Provider>
  if (status === "closed") return <ProfileChooser />
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-page-bg p-6 text-espresso">
    <BrandLogo />
    {status === "error" ? <><p role="alert">Could not open local profiles.</p><Button onClick={() => window.location.reload()}>Try again</Button></> : <p role="status" className="text-sm text-muted-text">Opening SciSpark…</p>}
  </main>
}
