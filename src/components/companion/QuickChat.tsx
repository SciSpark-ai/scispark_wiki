"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { Maximize2, X } from "lucide-react"
import { SparkyBadge } from "@/components/brand/SparkyBadge"
import { Composer } from "@/components/chat/Composer"
import { MessageList } from "@/components/chat/MessageList"
import { StreamingReply } from "@/components/chat/StreamingReply"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { askChatRemote } from "@/lib/chat/client"
import { saveAnswerAsQueryRemote } from "@/lib/chat/save-query-client"
import type { ChatMessage } from "@/lib/chat/session"
import { wikiHref } from "@/lib/wiki/href"

/** Stays mounted while closed so hiding the panel cannot cancel or replay a turn. */
export function QuickChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [question, setQuestion] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedSession, setSavedSession] = useState<string | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [savedPage, setSavedPage] = useState<string | null>(null)
  const sessionId = useRef<string | null>(null)
  const sending = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const follow = useRef(true)

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")?.focus()
  }, [open])
  useLayoutEffect(() => {
    if (open && follow.current && history.current) history.current.scrollTop = history.current.scrollHeight
  }, [open, messages, draft, busy, error])

  async function submit() {
    const text = question.trim()
    if (!text || sending.current) return
    sending.current = true; setBusy(true); setError(null); setDraft(""); follow.current = true
    const id = sessionId.current ?? `chat_${crypto.randomUUID()}`
    sessionId.current = id
    try {
      const result = await askChatRemote({ sessionId: id, operationId: crypto.randomUUID(), question: text, mode: "chat", readSourcesOnly: false }, undefined, undefined, setDraft)
      setMessages(previous => [...previous, { role: "user", content: text }, result.message])
      setSavedSession(result.sessionId); setQuestion("")
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { sending.current = false; setBusy(false); setDraft("") }
  }
  async function save(index: number) {
    if (!savedSession) return
    setSaving(index); setError(null)
    try {
      const message = messages[index]
      const result = await saveAnswerAsQueryRemote({ question: messages[index - 1]?.content ?? "Research question", answer: message.content, sessionId: savedSession, citedPageIds: message.citedPageIds ?? [] })
      setSavedPage(result.pageId)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(null) }
  }

  return <div ref={panel} id="sparky-quick-chat" role="dialog" aria-label="Chat with Sparky" hidden={!open}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}
    className={`${open ? "flex" : "hidden"} absolute bottom-full right-0 mb-3 h-[520px] max-h-[calc(100dvh-112px)] w-[400px] max-w-[calc(100vw-40px)] flex-col overflow-hidden rounded-[20px] border border-border-warm bg-page-bg shadow-xl`}>
    <header className="flex shrink-0 items-center gap-3 border-b border-border-warm px-4 py-3">
      <SparkyBadge /><div className="min-w-0 flex-1"><h2 className="font-heading text-[22px] leading-tight text-espresso">Sparky</h2><p className="text-[11px] text-muted-text">Your research companion</p></div>
      {savedSession && <Link href={`/chat/${savedSession}`} aria-label="Open full conversation" title="Open full conversation" className="rounded-full p-2 text-muted-text hover:text-espresso"><Maximize2 size={16} aria-hidden="true" /></Link>}
      <button type="button" onClick={onClose} aria-label="Close Sparky chat" className="rounded-full p-2 text-muted-text hover:text-espresso focus-visible:outline-2 focus-visible:outline-accent-ink"><X size={18} aria-hidden="true" /></button>
    </header>
    <div ref={history} onScroll={() => { const node = history.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64 }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
      {messages.length ? <MessageList messages={messages} pageTitleById={{}} onSaveMessage={save} savingIndex={saving} /> : !busy && <div className="flex min-h-full flex-col justify-center px-3"><h3 className="font-heading text-[24px] text-espresso">What are you exploring?</h3><p className="mt-2 text-[13px] leading-relaxed text-muted-text">Ask about your saved research. Your conversation will be available in History.</p></div>}
      {busy && <div className="space-y-3"><p className="rounded-card bg-card-surface p-3 text-[13px] text-espresso">{question}</p><StreamingReply text={draft} label={draft ? "Sparky is responding…" : "Sparky is thinking…"} /></div>}
      {error && <div className="mt-3"><LlmErrorMessage message={error} /></div>}
      {savedPage && <p className="mt-3 text-xs text-muted-text">Saved to your knowledge base. <Link className="text-accent-ink" href={wikiHref(savedPage)}>View page</Link></p>}
    </div>
    <footer className="shrink-0 border-t border-border-warm p-3"><Composer value={question} onChange={setQuestion} onSubmit={submit} busy={busy} placeholder="Ask Sparky…" /></footer>
  </div>
}
