"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listSessions, type ChatSession } from "@/lib/chat/session"
import {
  getChangePreviewRemote,
  listChangesRemote,
  undoChangeRemote,
} from "@/lib/history/client"
import type {
  ChangesetHistoryPreview,
  ChangesetHistoryRecord,
} from "@/lib/vault/history"
import { LoadingState } from "@/components/ui/LoadingState"

type Tab = "conversations" | "changes"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function previewText(value: string | null): string {
  if (value === null) return "(file absent)"
  const limit = 4_000
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… preview truncated`
}

function statusExplanation(change: ChangesetHistoryRecord): string | null {
  if (change.status === "reverted") return "Already undone."
  if (change.status === "diverged") {
    return `Undo is blocked because these paths were edited independently: ${change.divergedPaths.join(", ")}`
  }
  return null
}

export function HistoryPageClient() {
  const searchParams = useSearchParams()
  const activeTab: Tab = searchParams.get("tab") === "changes" ? "changes" : "conversations"
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [changes, setChanges] = useState<ChangesetHistoryRecord[] | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [preview, setPreview] = useState<ChangesetHistoryPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [undoingId, setUndoingId] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const reloadChanges = useCallback(async () => {
    setChanges(await listChangesRemote())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const loaded = await listSessions(vault)
        if (!cancelled) setSessions(loaded)
      } catch (error) {
        if (!cancelled) setSessionError(error instanceof Error ? error.message : String(error))
      }
    })()
    ;(async () => {
      try {
        const loaded = await listChangesRemote()
        if (!cancelled) setChanges(loaded)
      } catch (error) {
        if (!cancelled) setChangeError(error instanceof Error ? error.message : String(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const conversationGroups = useMemo(() => {
    if (sessions === null) return []
    const groups = new Map<string, ChatSession[]>()
    for (const session of sessions) {
      const key = new Date(session.updatedAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
      groups.set(key, [...(groups.get(key) ?? []), session])
    }
    return [...groups.entries()]
  }, [sessions])

  async function togglePreview(changesetId: string) {
    if (openId === changesetId) {
      setOpenId(null)
      setPreview(null)
      return
    }
    setOpenId(changesetId)
    setPreview(null)
    setPreviewBusy(true)
    setActionError(null)
    try {
      setPreview(await getChangePreviewRemote(changesetId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function undo(change: ChangesetHistoryRecord) {
    if (change.status !== "applied" || undoingId !== null) return
    if (!window.confirm(`Undo ${change.skill} across ${change.files.length} file${change.files.length === 1 ? "" : "s"}?`)) return
    setUndoingId(change.changesetId)
    setActionError(null)
    setWarning(null)
    try {
      const result = await undoChangeRemote(change.changesetId)
      window.dispatchEvent(new Event("scispark:feedback-changed"))
      if (result.warnings.length > 0) setWarning(result.warnings.map((item) => item.message).join(" "))
      await reloadChanges()
      if (openId === change.changesetId) setPreview(await getChangePreviewRemote(change.changesetId))
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
      await reloadChanges().catch(() => undefined)
    } finally {
      setUndoingId(null)
    }
  }

  return (
    <div className="p-7">
      <h1 className="font-heading text-[28px] tracking-heading text-espresso">History</h1>
      <p className="mt-1 text-[14px] text-muted-text">Revisit conversations and inspect recoverable vault changes.</p>

      <nav aria-label="History views" className="mt-5 flex gap-1 border-b border-border-warm/30">
        {(["conversations", "changes"] as const).map((tab) => (
          <Link
            key={tab}
            href={`/history?tab=${tab}`}
            className={`relative px-4 py-2.5 text-[14px] capitalize ${activeTab === tab ? "font-medium text-espresso" : "text-muted-text hover:text-espresso"}`}
          >
            {tab}
            {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-orange" />}
          </Link>
        ))}
      </nav>

      {actionError && <div role="alert" className="mt-4 rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-red-700">{actionError}</div>}
      {warning && <div className="mt-4 rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-espresso">The undo succeeded, with a derived-data warning: {warning}</div>}

      {activeTab === "conversations" && (
        <section className="mt-5">
          {sessionError ? (
            <div role="alert" className="rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-red-700">Conversations could not be loaded: {sessionError}</div>
          ) : sessions === null ? <LoadingState label="Loading conversations…" /> : conversationGroups.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center">
              <p className="text-[14px] text-espresso">No conversations yet</p>
              <Link href="/chat" className="mt-2 inline-block text-[13px] text-orange">Start a chat →</Link>
            </div>
          ) : conversationGroups.map(([month, items]) => (
            <div key={month} className="mb-6">
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-text">{month}</h2>
              <div className="space-y-1">
                {items.map((session) => (
                  <Link key={session.id} href={`/chat/${session.id}`} className="flex items-center justify-between gap-4 rounded-card px-3 py-2.5 hover:bg-light-surface">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-espresso">{session.title}</span>
                      {session.projectId && <span className="block truncate text-[11px] text-muted-text">Project · {session.projectTitle ?? session.projectId}</span>}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-text">{formatDate(session.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "changes" && (
        <section className="mt-5">
          {changeError ? (
            <div role="alert" className="rounded-card border border-border-warm bg-card-surface p-3 text-[13px] text-red-700">Changes could not be loaded: {changeError}</div>
          ) : changes === null ? <LoadingState label="Loading changes…" /> : changes.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center text-[14px] text-espresso">No recorded vault changes yet.</div>
          ) : (
            <div className="space-y-3">
              {changes.map((change) => {
                const explanation = statusExplanation(change)
                const isOpen = openId === change.changesetId
                return (
                  <article key={change.changesetId} className="rounded-card border border-border-warm bg-light-surface p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button type="button" onClick={() => void togglePreview(change.changesetId)} className="flex min-w-0 items-start gap-2 text-left">
                        {isOpen ? <ChevronDown size={16} className="mt-0.5 shrink-0" /> : <ChevronRight size={16} className="mt-0.5 shrink-0" />}
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium text-espresso">{change.skill}</span>
                          <span className="block text-[12px] text-muted-text">{formatDate(change.timestamp)} · {change.files.length} file{change.files.length === 1 ? "" : "s"}</span>
                        </span>
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="rounded-pill bg-card-surface px-2 py-1 text-[11px] uppercase tracking-wide text-muted-text">{change.status}</span>
                        <button type="button" disabled={change.status !== "applied" || undoingId !== null} onClick={() => void undo(change)} className="flex items-center gap-1.5 rounded-pill border border-border-warm px-3 py-1.5 text-[12px] text-espresso disabled:cursor-not-allowed disabled:opacity-40">
                          <RotateCcw size={13} />{undoingId === change.changesetId ? "Undoing…" : "Undo"}
                        </button>
                      </div>
                    </div>
                    <ul className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-text">
                      {change.files.map((file) => <li key={file.path} className="rounded-pill bg-card-surface px-2 py-1">{file.operation} · {file.path}</li>)}
                    </ul>
                    {explanation && <p className="mt-2 text-[12px] text-muted-text">{explanation}</p>}
                    {isOpen && (
                      <div className="mt-4 border-t border-border-warm/30 pt-4">
                        {previewBusy && <LoadingState label="Loading preview…" />}
                        {preview && preview.changes.map((file) => (
                          <div key={file.path} className="mb-4 last:mb-0">
                            <h3 className="text-[12px] font-medium text-espresso">{file.path}</h3>
                            <div className="mt-2 grid gap-2 lg:grid-cols-2">
                              <div><p className="mb-1 text-[11px] uppercase tracking-wide text-muted-text">Before</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-card bg-card-surface p-3 text-[11px] text-espresso">{previewText(file.before)}</pre></div>
                              <div><p className="mb-1 text-[11px] uppercase tracking-wide text-muted-text">After</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-card bg-card-surface p-3 text-[11px] text-espresso">{previewText(file.after)}</pre></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
