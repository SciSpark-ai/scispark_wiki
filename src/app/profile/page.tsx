"use client"

import Link from "next/link"
import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { Camera, Pencil, RotateCcw, UserRound, X } from "lucide-react"
import { PageHeader } from "@/components/ui/PageHeader"
import { loadUserProfile, updateUserProfileRemote } from "@/lib/usermodel/profile-client"
import type { EditableUserProfile, UserProfileDetail } from "@/lib/usermodel/profile"
import { useUserStore } from "@/stores/user-store"
import { RecommendationControls } from "@/components/feed/RecommendationControls"
import { DEFAULT_RECOMMENDATION_PREFERENCES } from "@/lib/recommendation/contract"

const MAX_AVATAR_FILE_BYTES = 1_000_000

const FIELD_CONFIG: Array<{
  key: keyof Pick<EditableUserProfile, "role" | "fields" | "topics" | "feedPrefs">
  label: string
  description: string
  placeholder: string
}> = [
  {
    key: "role",
    label: "Role",
    description: "How Sparky should understand your research perspective.",
    placeholder: "For example: PhD student studying pediatric language and neuroimaging",
  },
  {
    key: "fields",
    label: "Research fields",
    description: "The broader research worlds you work in or follow.",
    placeholder: "Fields you work in or actively follow",
  },
  {
    key: "topics",
    label: "Active topics",
    description: "Current questions, methods, or topics. Add one per line.",
    placeholder: "One topic per line",
  },
  {
    key: "feedPrefs",
    label: "Feed preferences",
    description: "What makes recommendations useful to you.",
    placeholder: "For example: prioritize methods and include adjacent ideas",
  },
]

function editable(profile: UserProfileDetail): EditableUserProfile {
  return {
    name: profile.name,
    role: profile.role,
    fields: profile.fields,
    topics: profile.topics,
    feedPrefs: profile.feedPrefs,
    avatarDataUrl: profile.avatarDataUrl,
    recommendations: profile.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES,
  }
}

function sameProfile(profile: UserProfileDetail, draft: EditableUserProfile): boolean {
  return JSON.stringify(editable(profile)) === JSON.stringify(draft)
}

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?"
}

function Avatar({ profile }: { profile: EditableUserProfile }) {
  const dimensions = "h-24 w-24 text-[30px]"
  return profile.avatarDataUrl ? (
    // The source is a locally validated image data URL stored in the user's vault.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={profile.avatarDataUrl}
      alt={`${profile.name || "User"} profile`}
      className={`${dimensions} rounded-full object-cover ring-4 ring-white`}
    />
  ) : (
    <span className={`${dimensions} flex items-center justify-center rounded-full bg-orange font-medium text-on-accent ring-4 ring-white`}>
      {avatarInitial(profile.name)}
    </span>
  )
}

export default function ProfilePage() {
  const setUser = useUserStore((state) => state.setUser)
  const [profile, setProfile] = useState<UserProfileDetail | null>(null)
  const [draft, setDraft] = useState<EditableUserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function reloadProfile() {
    setLoading(true)
    setError(null)
    try {
      const next = await loadUserProfile()
      setProfile(next)
      setDraft(next ? editable(next) : null)
      if (next) setUser({ name: next.name, avatar: next.avatarDataUrl ?? undefined })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reloadProfile()
    // This is an initial vault hydration; reloadProfile is stable for the page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function beginEditing() {
    if (!profile) return
    setDraft(editable(profile))
    setError(null)
    setNotice(null)
    setEditing(true)
  }

  function cancelEditing() {
    if (!profile || saving) return
    setDraft(editable(profile))
    setError(null)
    setEditing(false)
  }

  function changeField(key: keyof EditableUserProfile, value: string | null) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
  }

  function handleAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.")
      return
    }
    if (file.size > MAX_AVATAR_FILE_BYTES) {
      setError("Choose an image smaller than 1 MB.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        changeField("avatarDataUrl", reader.result)
        setError(null)
      }
    }
    reader.onerror = () => setError("SciSpark could not read that image.")
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    if (!profile || !draft || saving || sameProfile(profile, draft)) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const mutation = await updateUserProfileRemote({ ...draft, revision: profile.revision })
      setProfile(mutation.result)
      setDraft(editable(mutation.result))
      setUser({ name: mutation.result.name, avatar: mutation.result.avatarDataUrl ?? undefined })
      setEditing(false)
      setNotice(
        mutation.warnings.length > 0
          ? `Profile saved. ${mutation.warnings.map((warning) => warning.message).join(" ")}`
          : "Profile saved.",
      )
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(
        message.includes("changed since")
          ? "Your profile changed after this page loaded. Reload it before saving again."
          : message,
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-7">
        <PageHeader title="Profile" />
        <div className="mt-6 rounded-[18px] border border-border-warm/40 bg-light-surface p-8 text-[14px] text-muted-text">
          Opening your local profile…
        </div>
      </div>
    )
  }

  if (!profile || !draft) {
    const failedToLoad = error !== null
    return (
      <div className="p-7">
        <PageHeader title="Profile" />
        <div className="mt-6 rounded-[18px] border border-border-warm/40 bg-light-surface p-8">
          {failedToLoad ? (
            <RotateCcw className="mb-4 text-accent-ink" aria-hidden="true" />
          ) : (
            <UserRound className="mb-4 text-accent-ink" aria-hidden="true" />
          )}
          <h2 className="font-heading text-[22px] text-espresso">
            {failedToLoad ? "SciSpark could not open your profile" : "Sparky has not met you yet"}
          </h2>
          <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted-text">
            {failedToLoad
              ? error
              : "Start a short conversation so SciSpark can personalize your research feed and companion."}
          </p>
          {failedToLoad ? (
            <button type="button" onClick={() => void reloadProfile()} className="mt-5 inline-flex items-center gap-2 rounded-pill bg-orange px-5 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90">
              <RotateCcw size={14} aria-hidden="true" /> Retry
            </button>
          ) : (
            <Link href="/onboarding" className="mt-5 inline-flex rounded-pill bg-orange px-5 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90">
              Meet Sparky
            </Link>
          )}
        </div>
      </div>
    )
  }

  const hasChanges = !sameProfile(profile, draft)

  return (
    <div className="p-7 pb-12">
      <PageHeader title="Profile" />

      <section className="relative mt-6 overflow-hidden rounded-[20px] border border-border-warm/40 bg-light-surface">
        <div className="h-24 bg-[linear-gradient(115deg,var(--color-card-surface),var(--color-page-warm))]" />
        <div className="flex flex-col gap-5 px-6 pb-6 sm:flex-row sm:items-end sm:px-8">
          <div className="-mt-12 shrink-0 self-start">
            <div className="relative w-fit" data-testid="profile-avatar">
              <Avatar profile={draft} />
              <button
                type="button"
                aria-label="Change profile photo"
                aria-describedby="profile-photo-help"
                title="Change profile photo"
                disabled={saving}
                onClick={() => { if (!editing) beginEditing(); fileInputRef.current?.click() }}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border border-border-warm bg-light-surface text-espresso shadow-sm ring-2 ring-light-surface transition-colors hover:bg-card-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange focus-visible:ring-offset-2 focus-visible:ring-offset-light-surface disabled:opacity-50"
              >
                <Camera size={16} aria-hidden="true" />
              </button>
            </div>
            <input ref={fileInputRef} type="file" aria-label="Profile photo" accept="image/png,image/jpeg,image/webp" onChange={handleAvatar} disabled={saving} hidden />
            <span id="profile-photo-help" className="sr-only">PNG, JPEG, or WebP, up to 1 MB. Choose a photo, then Save changes.</span>
            {editing && draft.avatarDataUrl && (
              <button type="button" disabled={saving} onClick={() => changeField("avatarDataUrl", null)} className="mt-2 inline-flex items-center gap-1 rounded-pill py-1 text-[12px] text-muted-text hover:text-espresso focus-visible:outline-2 focus-visible:outline-orange disabled:opacity-50">
                <X size={12} aria-hidden="true" /> Remove photo
              </button>
            )}
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            {editing ? (
              <div>
                <label htmlFor="profile-name" className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.08em] text-muted-text">Name</label>
                <input
                  id="profile-name"
                  value={draft.name}
                  onChange={(event) => changeField("name", event.target.value)}
                  maxLength={100}
                  className="w-full max-w-[420px] rounded-[10px] border border-border-warm bg-white px-3 py-2 text-[16px] text-espresso outline-none focus:border-orange"
                />
              </div>
            ) : (
              <>
                <h2 className="truncate font-heading text-[26px] text-espresso">{profile.name}</h2>
                <p className="mt-0.5 truncate text-[14px] text-muted-text">{profile.role}</p>
              </>
            )}
          </div>
          {!editing && (
            <button type="button" onClick={beginEditing} className="inline-flex items-center justify-center gap-2 rounded-pill border border-espresso/15 px-4 py-2 text-[13px] font-medium text-espresso transition-colors hover:bg-card-surface">
              <Pencil size={14} aria-hidden="true" /> Edit profile
            </button>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-[18px] border border-border-warm/40 bg-light-surface p-6 sm:p-8">
        <div className="mb-6">
          <h2 className="font-heading text-[20px] text-espresso">Research context</h2>
          <p className="mt-1 text-[13px] text-muted-text">These are the answers Sparky uses to personalize your feed and conversations.</p>
        </div>

        <div className="divide-y divide-border-warm/50">
          {FIELD_CONFIG.map((field) => (
            <div key={field.key} className="grid gap-3 py-5 first:pt-0 last:pb-0 sm:grid-cols-[180px_1fr] sm:gap-8">
              <div>
                <label htmlFor={`profile-${field.key}`} className="text-[13px] font-medium text-espresso">{field.label}</label>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-text">{field.description}</p>
              </div>
              {editing ? (
                <textarea
                  id={`profile-${field.key}`}
                  value={draft[field.key]}
                  onChange={(event) => changeField(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  rows={field.key === "topics" ? 4 : 3}
                  className="w-full resize-y rounded-[12px] border border-border-warm bg-white px-3.5 py-3 text-[14px] leading-relaxed text-espresso outline-none placeholder:text-muted-text focus:border-orange"
                />
              ) : (
                <p className="whitespace-pre-line text-[14px] leading-relaxed text-espresso">
                  {profile[field.key] || <span className="text-muted-text">Not answered yet</span>}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section id="recommendations" className="mt-4 rounded-[18px] border border-border-warm/40 bg-light-surface p-6 sm:p-8">
        <h2 className="mb-4 font-heading text-[20px] text-espresso">Paper recommendations</h2>
        {editing ? <RecommendationControls value={draft.recommendations ?? DEFAULT_RECOMMENDATION_PREFERENCES} onChange={(recommendations) => setDraft((previous) => previous ? { ...previous, recommendations } : previous)} allowReset disabled={saving} /> : <>
          <p className="text-[14px] text-espresso">Exploration: {profile.recommendations?.diversity ?? "balanced"}. Feedback learning: {profile.recommendations?.learnFromFeedback === false ? "off" : "on"}.</p>
          <p className="mt-2 text-[13px] text-muted-text">Relevance 70% · recency 20% · venue standing 10%. Missing venue metrics are neutral, not guessed. Edit profile to change exploration or reset learned preferences.</p>
        </>}
      </section>

      {(error || notice) && (
        <div className={`mt-4 rounded-[12px] border px-4 py-3 text-[13px] ${error ? "border-red-200 bg-red-50 text-red-800" : "border-border-warm bg-card-surface text-espresso"}`} role={error ? "alert" : "status"}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error ?? notice}</span>
            {error?.includes("Reload") && (
              <button type="button" onClick={() => void reloadProfile()} className="inline-flex items-center gap-1.5 font-medium underline underline-offset-2">
                <RotateCcw size={13} aria-hidden="true" /> Reload profile
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <div className="sticky bottom-4 mt-5 flex justify-end gap-3 rounded-[16px] border border-border-warm bg-light-surface/95 p-3 shadow-sm backdrop-blur">
          <button type="button" onClick={cancelEditing} disabled={saving} className="rounded-pill px-5 py-2.5 text-[14px] font-medium text-espresso hover:bg-card-surface disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void saveProfile()} disabled={saving || !hasChanges || !draft.name.trim() || !draft.role.trim() || !draft.fields.trim()} className="rounded-pill bg-orange px-5 py-2.5 text-[14px] font-medium text-on-accent hover:bg-orange/90 disabled:opacity-45">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  )
}
