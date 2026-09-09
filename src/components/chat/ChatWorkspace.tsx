"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listSessions, loadSession, type ChatSession } from "@/lib/chat/session"
import { askChatRemote, type ChatStage } from "@/lib/chat/client"
import { saveAnswerAsQueryRemote } from "@/lib/chat/save-query-client"
import { loadBundle } from "@/lib/vault/bundle"
import { getProjectRemote } from "@/lib/projects/client"
import { wikiHref } from "@/lib/wiki/href"
import { enabledSourcesSchema } from "@/lib/papers/source-preferences"
import type { SourceId } from "@/lib/papers/types"
import { useUIStore } from "@/stores/ui-store"
import { Composer } from "./Composer"
import { MessageList } from "./MessageList"
import { SourcesToggle } from "./SourcesToggle"
import { StreamingReply } from "./StreamingReply"
import { LoadingState } from "@/components/ui/LoadingState"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { prepareReview } from "@/lib/review/client"
import { ReviewReport } from "./ReviewReport"

const STAGE_LABELS: Record<ChatStage, string> = {
  selecting: "Reading your knowledge base…", answering: "Answering…",
  planning: "Understanding your question…", searching: "Searching the literature…", ranking: "Reading the strongest matches…",
}
const SOURCE_LABELS: Record<SourceId, string> = { arxiv: "arXiv", openalex: "OpenAlex", s2: "Semantic Scholar", pubmed: "PubMed" }

export function ChatWorkspace({ sessionId, fresh = false, initialMode = "chat" }: {
  sessionId?: string; fresh?: boolean; initialMode?: "chat" | "search"
}) {
  const router = useRouter()
  const openSettings = useUIStore((s) => s.openSettingsModal)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [recent, setRecent] = useState<ChatSession[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState("")
  const [mode, setMode] = useState<"chat" | "search" | "review">(initialMode)
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportVersion, setReportVersion] = useState<string | undefined>()
  const [readSourcesOnly, setReadSourcesOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<ChatStage | null>(null)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [sources, setSources] = useState<SourceId[]>([])
  const [enabledSources, setEnabledSources] = useState<SourceId[]>([])
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [showSources, setShowSources] = useState(false)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [savedPage, setSavedPage] = useState<string | null>(null)
  const sending = useRef(false)
  const mounted = useRef(true)
  const scroll = useRef<HTMLDivElement>(null)
  const draftKey = `scispark:chat-draft:${sessionId ?? "new"}`
  const draftOptions = useRef<{ mode: "chat" | "search" | "review"; readSourcesOnly: boolean; sources?: SourceId[] }>({ mode: initialMode, readSourcesOnly: false })

  useEffect(() => {
    const open = (event: Event) => {
      const data = (event as CustomEvent<unknown>).detail
      const id = typeof data === "string" ? data : data && typeof data === "object" && "runId" in data ? data.runId : null
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) return
      const version = data && typeof data === "object" && "versionId" in data && typeof data.versionId === "string" ? data.versionId : undefined
      setReportId(id); setReportVersion(version)
    }
    window.addEventListener("open-review-report", open)
    return () => window.removeEventListener("open-review-report", open)
  }, [])

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    try {
      setQuestion(sessionStorage.getItem(draftKey) ?? "")
      const options: unknown = JSON.parse(sessionStorage.getItem(`${draftKey}:options`) ?? "null")
      if (options && typeof options === "object" && "mode" in options && (options.mode === "chat" || options.mode === "search" || options.mode === "review")) {
        const saved = options as { mode: "chat" | "search" | "review"; readSourcesOnly?: unknown; sources?: unknown }
        const selected = Array.isArray(saved.sources) && saved.sources.every((s) => typeof s === "string" && Object.hasOwn(SOURCE_LABELS, s))
          ? saved.sources as SourceId[] : undefined
        draftOptions.current = { mode: saved.mode, readSourcesOnly: saved.readSourcesOnly === true, ...(selected ? { sources: selected } : {}) }
        setMode(draftOptions.current.mode)
        setReadSourcesOnly(draftOptions.current.readSourcesOnly)
      }
    } catch { /* A corrupt local draft cannot prevent reading server History. */ }
  }, [draftKey])
  function saveDraftOptions(next: Partial<typeof draftOptions.current>) {
    draftOptions.current = { ...draftOptions.current, ...next }
    try { sessionStorage.setItem(`${draftKey}:options`, JSON.stringify(draftOptions.current)) } catch {}
  }
  function changeQuestion(value: string) {
    setQuestion(value)
    saveDraftOptions({ mode, readSourcesOnly })
    try { sessionStorage.setItem(draftKey, value) } catch { /* Submitted history is server-owned. */ }
  }
  const reload = useCallback(async () => {
    const vault = await getOpenVault()
    const loaded = sessionId ? await loadSession(vault, sessionId) : null
    if (sessionId && !loaded) throw new Error("Conversation not found. It may have been removed or could not be read.")
    if (!mounted.current) return
    setSession(loaded)
    if (loaded?.projectId) {
      try { await getProjectRemote(loaded.projectId); setScopeError(null) }
      catch { setScopeError("This project's scope is unavailable. The transcript is preserved, but cannot continue.") }
    } else setScopeError(null)
    const bundle = await loadBundle(vault)
    if (mounted.current) setTitles(Object.fromEntries([...bundle.pages.values()].map((p) => [p.id, p.frontmatter.title])))
  }, [sessionId])
  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    ;(async () => {
      try {
        if (sessionId) await reload()
        else {
          const sessions = await listSessions(await getOpenVault())
          if (!alive) return
          const global = sessions.filter((s) => !s.projectId)
          if (!fresh && global[0]) { router.replace(`/chat/${global[0].id}`); return }
          setRecent(sessions.slice(0, 8)); setSession(null)
        }
      } catch (e) { if (alive) { setError(sessionId ? "Conversation not found. It may have been removed or could not be read." : e instanceof Error ? e.message : String(e)); if (sessionId) setScopeError("Open a saved conversation from History or start a new chat.") } }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [sessionId, fresh, reload, router])

  useEffect(() => {
    let alive = true
    async function loadSources() {
      try {
        const response = await fetch("/api/settings/paper-sources", { cache: "no-store", signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error("Could not load your paper sources.")
        const selected = enabledSourcesSchema.parse((await response.json()).enabledSources)
        if (alive) {
          setSources(draftOptions.current.sources?.filter((s) => selected.includes(s)) ?? selected)
          setEnabledSources(selected); setSourcesError(null)
        }
      } catch { if (alive) setSourcesError("Could not load your paper sources. Open Manage sources to check them.") }
    }
    void loadSources()
    window.addEventListener("paper-sources-changed", loadSources)
    return () => { alive = false; window.removeEventListener("paper-sources-changed", loadSources) }
  }, [])

  // Reading a pending snapshot never repeats its model/search request.
  useEffect(() => {
    if (!sessionId || busy || session?.messages.at(-1)?.role !== "user") return
    const timer = window.setInterval(() => { void reload().catch(() => undefined) }, 2000)
    return () => window.clearInterval(timer)
  }, [sessionId, busy, session, reload])
  useEffect(() => {
    if (!loading && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [loading, session?.messages.length, draft, busy])

  async function submit() {
    const q = question.trim()
    if (!q || sending.current || scopeError || (mode !== "chat" && (!sources.length || sourcesError))) return
    sending.current = true; setBusy(true); setError(null); setStage(null); setDraft("")
    const id = sessionId ?? `chat_${crypto.randomUUID()}`
    try { sessionStorage.setItem(`scispark:chat-draft:${id}:options`, JSON.stringify(draftOptions.current)) } catch {}
    try {
      if (mode === "review") {
        const run = await prepareReview({ sessionId: id, operationId: crypto.randomUUID(), question: q, sources })
        try { sessionStorage.removeItem(draftKey) } catch {}
        if (mounted.current) { setQuestion(""); if (sessionId) await reload(); else router.push(`/chat/${run.sessionId}`) }
        return
      }
      const result = await askChatRemote({ sessionId: id, question: q, readSourcesOnly, mode,
        ...(mode === "search" ? { sources } : {}), operationId: crypto.randomUUID(),
        ...(session?.projectId ? { projectId: session.projectId } : {}),
      }, (s) => { if (mounted.current) setStage(s) }, undefined, (text) => { if (mounted.current) setDraft(text) })
      try { sessionStorage.removeItem(draftKey) } catch {}
      if (!mounted.current) return
      setQuestion("")
      if (sessionId) await reload()
      else router.push(`/chat/${result.sessionId}`)
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { sending.current = false; if (mounted.current) { setBusy(false); setStage(null) } }
  }
  async function save(index: number) {
    if (!session) return
    const message = session.messages[index]
    setSavingIndex(index); setError(null)
    try {
      const result = await saveAnswerAsQueryRemote({ question: session.messages[index - 1]?.content ?? session.title, answer: message.content, sessionId: session.id, citedPageIds: message.citedPageIds ?? [] })
      setSavedPage(result.pageId)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSavingIndex(null) }
  }

  return <div className="flex h-full min-h-0 w-full">
    <div className={`${reportId ? "hidden max-w-[520px] lg:flex" : "flex max-w-[1180px]"} mx-auto h-full min-h-0 min-w-0 w-full flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6`}>
    <header className="mb-4 flex shrink-0 flex-col items-start justify-between gap-3 border-b border-border-warm pb-4 sm:flex-row sm:gap-4">
      <div className="min-w-0"><h1 className="font-heading text-[28px] leading-tight text-espresso sm:text-[34px]">{reportId ? "Review conversation" : session?.title ?? "Sparky"}</h1>
        <p className="mt-1 text-sm text-muted-text">{reportId ? "Ask questions. Refine your draft." : session?.projectId ? `Project conversation · ${session.projectTitle}. Scoped to current members.` : "Find papers. Discuss findings. Continue anytime."}</p></div>
      <nav className="flex shrink-0 flex-wrap gap-3 text-sm text-orange"><Link href="/history?tab=conversations">History</Link><Link href="/chat?new=1">New chat</Link></nav>
    </header>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" aria-label="Conversation">
      {loading ? <LoadingState label="Loading conversation…" /> : session ? <MessageList messages={session.messages} pageTitleById={titles} onSaveMessage={save} savingIndex={savingIndex} /> : <div className="flex min-h-full flex-col justify-center py-6">
        <h2 className="font-heading text-[28px] text-espresso">What would you like to explore?</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-text">Search scholarly sources or discuss your saved research. Every conversation stays in History.</p>
        {recent.length > 0 && <section className="mt-8"><h3 className="text-sm text-muted-text">Recent conversations</h3><ul className="mt-2 divide-y divide-border-warm">{recent.map((s) => <li key={s.id}><Link className="block py-3 text-sm text-espresso hover:text-orange" href={`/chat/${s.id}`}>{s.title}</Link></li>)}</ul></section>}
      </div>}
      {busy && <div className="mt-4"><StreamingReply text={draft} label={stage ? STAGE_LABELS[stage] : "Thinking…"} /></div>}
    </div>
    <footer className="mt-4 shrink-0 border-t border-border-warm pt-3">
      {scopeError && <p role="alert" className="mb-2 text-sm text-espresso">{scopeError}</p>}
      {error && <LlmErrorMessage message={error} />}
      {savedPage && <p className="mb-2 text-sm text-muted-text">Added to your knowledge base. <Link className="text-orange" href={wikiHref(savedPage)}>View page</Link></p>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-text">Mode <select aria-label="Chat mode" disabled={busy} value={mode} onChange={(e) => { const next = e.target.value as "chat" | "search" | "review"; setMode(next); setReadSourcesOnly(false); saveDraftOptions({ mode: next, readSourcesOnly: false }) }} className="ml-2 rounded-pill border border-border-warm bg-light-surface px-3 py-1.5 text-espresso"><option value="chat">Discuss research</option><option value="search">Find papers</option><option value="review">Deep literature review</option></select></label>
        {mode !== "chat" ? <><button type="button" className="text-sm text-muted-text hover:text-orange" aria-expanded={showSources} onClick={() => setShowSources(!showSources)}>Search scope</button><button type="button" onClick={() => openSettings("sources")} className="text-sm text-orange">Manage sources</button></> : <SourcesToggle value={readSourcesOnly} onChange={(value) => { setReadSourcesOnly(value); saveDraftOptions({ readSourcesOnly: value }) }} />}
      </div>
      {mode !== "chat" && showSources && <div className="mb-3 flex flex-wrap gap-3">{enabledSources.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm text-espresso"><input type="checkbox" disabled={busy} checked={sources.includes(s)} onChange={() => { const next = sources.includes(s) ? sources.filter((p) => p !== s) : [...sources, s]; setSources(next); saveDraftOptions({ sources: next }) }} />{SOURCE_LABELS[s]}</label>)}</div>}
      {mode !== "chat" && sourcesError && <p role="alert" className="mb-2 text-sm text-espresso">{sourcesError}</p>}
      <Composer value={question} onChange={changeQuestion} onSubmit={submit} busy={busy || loading || Boolean(scopeError) || (mode !== "chat" && (!sources.length || Boolean(sourcesError)))} placeholder={mode === "review" ? "What question should this literature review investigate?" : mode === "search" ? "Ask a research question to find papers…" : "Ask about your research or the papers above…"} />
      <p className="mt-2 text-xs text-muted-text">Enter to send. Shift+Enter for a new line.</p>
    </footer>
    </div>
    {reportId && <ReviewReport key={`${reportId}:${reportVersion ?? "latest"}`} id={reportId} initialVersion={reportVersion} onClose={() => setReportId(null)} />}
  </div>
}
