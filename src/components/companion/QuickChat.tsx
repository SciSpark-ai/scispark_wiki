"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Maximize2, X } from "lucide-react"
import { SparkyBadge } from "@/components/brand/SparkyBadge"
import { Composer } from "@/components/chat/Composer"
import { MessageList } from "@/components/chat/MessageList"
import { StreamingReply } from "@/components/chat/StreamingReply"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { askChatRemote, CHAT_STAGE_LABELS, type ChatStage } from "@/lib/chat/client"
import { saveAnswerAsQueryRemote } from "@/lib/chat/save-query-client"
import { isValidSessionId, loadSession, type ChatMessage } from "@/lib/chat/session"
import type { ChatSelection } from "@/lib/chat/blocks"
import { observeSkillJob } from "@/lib/skills/job-client"
import type { SparkySelectionRequest } from "./selection-request"
import { wikiHref } from "@/lib/wiki/href"
import { getOpenVault } from "@/lib/vault/get-vault"
import { resolvePaperBySlug } from "@/lib/papers/resolve"
import type { PaperTextInfo } from "@/lib/papers/text-contract"

/** Stays mounted while closed so hiding the panel cannot cancel or replay a turn. */
export function QuickChat({ open, onClose, paperSlug, selectionRequest, onSelectionHandled }: { open: boolean; onClose: () => void; paperSlug?: string; selectionRequest?: SparkySelectionRequest; onSelectionHandled?: (id: string) => void }) {
  const [paperTitle, setPaperTitle] = useState<string | null>(null)
  const [paperLoadFailed, setPaperLoadFailed] = useState(false)
  const [paperSource, setPaperSource] = useState<PaperTextInfo>()
  const [selection, setSelection] = useState<ChatSelection>()
  const [ready, setReady] = useState(false)
  const handledSelection = useRef<string | null>(null)
  const mounted = useRef(true)
  const storageKey = `scispark:quick-chat:${paperSlug ?? "global"}`
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [stage, setStage] = useState<ChatStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedSession, setSavedSession] = useState<string | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [savedPage, setSavedPage] = useState<string | null>(null)
  const sessionId = useRef<string | null>(null)
  const sending = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  useEffect(() => {
    if (!open || !paperSlug || paperTitle) return
    let alive = true
    setPaperLoadFailed(false)
    void getOpenVault().then(vault => resolvePaperBySlug(vault, paperSlug)).then(paper => {
      if (alive) { setPaperTitle(paper?.title ?? null); setPaperLoadFailed(!paper) }
    }).catch(() => { if (alive) setPaperLoadFailed(true) })
    return () => { alive = false }
  }, [open, paperSlug, paperTitle])

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")?.focus()
  }, [open, ready, busy])
  useLayoutEffect(() => {
    if (open && follow.current && history.current) history.current.scrollTop = history.current.scrollHeight
  }, [open, messages, draft, busy, error])

  const reloadConversation = useCallback(async (id: string) => {
    const session = await loadSession(await getOpenVault(), id)
    if (!mounted.current) return
    if (session && session.paperContext?.slug !== paperSlug) throw new Error("This conversation belongs to another paper.")
    if (session) { setMessages(session.messages); setPaperSource(session.paperContext?.source) }
  }, [paperSlug])

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  // Browser storage holds only a pointer. Transcript and job state live in the
  // profile's vault; closing the panel stops observation, never the work.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setReady(false)
    void (async () => {
      try {
        let id = sessionId.current
        try { id ??= sessionStorage.getItem(storageKey) } catch {}
        if (id && isValidSessionId(id)) {
          sessionId.current = id; setSavedSession(id)
          await reloadConversation(id)
          await observeSkillJob(`chat:${id}`, async job => {
            if (controller.signal.aborted) return
            if (sending.current) { setReady(true); return }
            if (job.status === "running") {
              setBusy(true)
              const stage = job.progress?.stage
              if (typeof stage === "string" && Object.hasOwn(CHAT_STAGE_LABELS, stage)) setStage(stage as ChatStage)
              if (typeof job.progress?.text === "string") setDraft(job.progress.text)
            } else {
              await reloadConversation(id)
              if (controller.signal.aborted) return
              setBusy(false); setDraft("")
              if (job.status !== "completed") setError(job.error ?? "The answer was interrupted. Your question is saved in History.")
            }
            setReady(true)
          }, controller.signal)
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          if (!sending.current) { setBusy(false); setDraft("") }
          setError(e instanceof Error ? e.message : "Could not reconnect. Reopen Sparky to try again.")
        }
      } finally { if (!controller.signal.aborted) setReady(true) }
    })()
    return () => controller.abort()
  }, [open, reloadConversation, storageKey])

  const send = useCallback(async (text: string, passage?: ChatSelection, operationId = crypto.randomUUID()) => {
    if (!text.trim() || sending.current) return
    sending.current = true; setBusy(true); setError(null); setDraft(""); setStage(null); follow.current = true
    const id = sessionId.current ?? `chat_${crypto.randomUUID()}`
    sessionId.current = id; setSavedSession(id)
    try { sessionStorage.setItem(storageKey, id); sessionStorage.setItem("scispark:active-chat", id) } catch {}
    setMessages(previous => [...previous, { role: "user", content: text, ...(passage ? { selection: passage } : {}) }])
    setQuestion(""); setSelection(undefined)
    try {
      const result = await askChatRemote({ sessionId: id, operationId, question: text, mode: "chat", readSourcesOnly: false,
        ...(paperSlug ? { paperSlug } : {}), ...(passage ? { selection: passage } : {}) }, stage => { if (mounted.current) setStage(stage) }, undefined,
        text => { if (mounted.current) setDraft(text) })
      if (!mounted.current) return
      await reloadConversation(result.sessionId)
      setPaperSource(result.paperSource)
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      sending.current = false
      if (mounted.current) { setBusy(false); setDraft("") }
    }
  }, [paperSlug, reloadConversation, storageKey])

  useEffect(() => {
    if (!open || !ready || !selectionRequest || handledSelection.current === selectionRequest.id) return
    handledSelection.current = selectionRequest.id
    onSelectionHandled?.(selectionRequest.id)
    if (busy || sending.current) {
      // Keep a second selection as a draft; never silently start a queued call.
      setSelection(selectionRequest.selection); setQuestion("Explain this passage.")
    } else {
      void send("Explain this passage.", selectionRequest.selection, selectionRequest.id)
    }
  }, [open, ready, busy, selectionRequest, send, onSelectionHandled])

  function submit() { if (ready && !busy) void send(question.trim(), selection) }
  async function save(index: number) {
    if (!savedSession || savingRef.current) return
    savingRef.current = true
    setSaving(index); setError(null)
    try {
      const message = messages[index]
      const result = await saveAnswerAsQueryRemote({ question: messages[index - 1]?.content ?? "Research question", answer: message.content, sessionId: savedSession, citedPageIds: message.citedPageIds ?? [] })
      setSavedPage(result.pageId)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { savingRef.current = false; setSaving(null) }
  }

  return <div ref={panel} id="sparky-quick-chat" role="dialog" aria-label="Chat with Sparky" hidden={!open}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}
    className={`${open ? "flex" : "hidden"} absolute bottom-full right-0 mb-3 h-[520px] max-h-[calc(100dvh-112px)] w-[400px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-[20px] border border-border-warm bg-page-bg shadow-xl`}>
    <header className="flex shrink-0 items-center gap-3 border-b border-border-warm px-4 py-3">
      <SparkyBadge /><h2 className="min-w-0 flex-1 font-heading text-[22px] leading-tight text-espresso">Sparky</h2>
      {savedSession && <Link href={`/chat/${savedSession}`} onClick={onClose} aria-label="Open full conversation" title="Open full conversation" className="rounded-full p-2 text-muted-text hover:text-espresso"><Maximize2 size={16} aria-hidden="true" /></Link>}
      <button type="button" onClick={onClose} aria-label="Close Sparky chat" className="rounded-full p-2 text-muted-text hover:text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"><X size={18} aria-hidden="true" /></button>
    </header>
    {paperSlug && <div aria-label="Paper context" className="shrink-0 border-b border-border-warm bg-light-surface px-4 py-3">
      <p className="text-[11px] text-muted-text">This paper</p>
      <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-espresso" title={paperTitle ?? undefined}>{paperTitle ?? (paperLoadFailed ? "Paper unavailable. Reopen it to retry." : "Loading paper…")}</p>
      {paperSource && <p className="mt-1 text-[11px] text-muted-text">{paperSource.access === "full-text" ? paperSource.truncated ? "Full-text excerpt" : "Full text" : "Abstract only"}</p>}
    </div>}
    <div ref={history} onScroll={() => { const node = history.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64 }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      {messages.length ? <MessageList messages={messages} pageTitleById={{}} onSaveMessage={save} savingIndex={saving} /> : !busy && <div className="flex min-h-full flex-col justify-center px-3"><h3 className="font-heading text-[24px] text-espresso">{paperSlug ? "Let's unpack this paper." : "What are you exploring?"}</h3></div>}
      {busy && <div className="mt-3"><StreamingReply text={draft} label={stage ? CHAT_STAGE_LABELS[stage] : undefined} /></div>}
      {error && <div className="mt-3"><LlmErrorMessage message={error} /></div>}
      {savedPage && <p className="mt-3 text-xs text-muted-text">Saved to your knowledge base. <Link className="text-accent-ink" href={wikiHref(savedPage)}>View page</Link></p>}
    </div>
    <footer className="shrink-0 border-t border-border-warm p-3">
      {selection && <div className="mb-2 flex items-start gap-2 rounded-lg bg-card-surface p-2"><blockquote aria-label="Selected passage draft" className="max-h-20 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-text">{selection.text}</blockquote><button type="button" aria-label="Remove selected passage" onClick={() => setSelection(undefined)} className="p-1 text-muted-text"><X size={14} /></button></div>}
      <Composer value={question} onChange={setQuestion} onSubmit={submit} busy={busy || !ready} placeholder={paperSlug ? "Ask about this paper…" : "Ask Sparky…"} /></footer>
  </div>
}
