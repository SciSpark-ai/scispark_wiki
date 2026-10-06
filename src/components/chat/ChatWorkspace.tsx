"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpen, Clock } from "lucide-react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listSessions, loadSession, type ChatSession } from "@/lib/chat/session"
import { askChatRemote, CHAT_STAGE_LABELS as STAGE_LABELS, type ChatStage } from "@/lib/chat/client"
import { observeSkillJob } from "@/lib/skills/job-client"
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

import { listToolsRemote, parseToolIntent } from "@/lib/extensions/client"
import type { LibraryTool } from "@/lib/extensions/ui-contract"
import type { ToolRef } from "@/lib/extensions/contracts"

const SOURCE_LABELS: Record<SourceId, string> = { arxiv: "arXiv", openalex: "OpenAlex", s2: "Semantic Scholar", pubmed: "PubMed" }
// Per-tab navigation only; ProfileGate clears this with drafts on profile changes.
const ACTIVE_CHAT_KEY = "scispark:active-chat"

export function ChatWorkspace({ sessionId, fresh = false, resume = false, initialMode = "chat", initialTool }: {
  sessionId?: string; fresh?: boolean; resume?: boolean; initialMode?: "chat" | "search"; initialTool?: string
}) {
  const router = useRouter()
  const openSettings = useUIStore((s) => s.openSettingsModal)
  const [session, setSession] = useState<ChatSession | null>(null)
  const [recent, setRecent] = useState<ChatSession[]>([])
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState("")
  const [mode, setMode] = useState<"chat" | "search" | "review">(initialMode)
  const [tools, setTools] = useState<LibraryTool[]>([])
  const [selectedTool, setSelectedTool] = useState<ToolRef | undefined>()
  const [toolError, setToolError] = useState<string | null>(null)
  const [toolPending, setToolPending] = useState(initialTool !== undefined)
  // An explicit composer replacement supersedes the URL for later refreshes too.
  const selectionOverride = useRef<{ tool?: ToolRef } | null>(null)
  useEffect(() => {
    let alive = true
    selectionOverride.current = null
    setToolPending(initialTool !== undefined)
    function requestedTool() {
      if (selectionOverride.current) return selectionOverride.current.tool ? JSON.stringify(selectionOverride.current.tool) : undefined
      return initialTool ?? (draftOptions.current.tool ? JSON.stringify(draftOptions.current.tool) : undefined)
    }
    async function load() {
      try {
        const library = await listToolsRemote(), enabled = library.tools.filter(t => t.enabled)
        if (!alive) return
        setTools(enabled)
        const requested = requestedTool()
        if (requested !== undefined) {
          const ref = parseToolIntent(requested)
          if (!enabled.some(t => JSON.stringify(t.ref) === JSON.stringify(ref) && t.readiness.status === "ready")) throw new Error("This tool is unavailable. Open Tools to enable it or finish setup.")
          setSelectedTool(ref); setMode("chat"); setToolError(null)
        } else setToolError(null)
      } catch { if (alive && requestedTool() !== undefined) setToolError("This tool link is unavailable. Open Tools to choose an enabled tool.") }
      finally { if (alive) setToolPending(false) }
    }
    void load(); window.addEventListener("scispark-tools-changed", load)
    return () => { alive = false; window.removeEventListener("scispark-tools-changed", load) }
  }, [initialTool])
  const usesSourceScope = selectedTool
    ? selectedTool.packageId === "scispark.builtin" && ["find-papers", "deep-review"].includes(selectedTool.skillId)
    : mode !== "chat"
  const toolSelected = (tool: ToolRef) => selectedTool ? JSON.stringify(selectedTool) === JSON.stringify(tool) : tool.packageId === "scispark.builtin" && ((mode === "search" && tool.skillId === "find-papers") || (mode === "review" && tool.skillId === "deep-review"))
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
  const draftOptions = useRef<{ mode: "chat" | "search" | "review"; readSourcesOnly: boolean; sources?: SourceId[]; tool?: ToolRef }>({ mode: initialMode, readSourcesOnly: false })

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
        const saved = options as { mode: "chat" | "search" | "review"; readSourcesOnly?: unknown; sources?: unknown; tool?: unknown }
        const selected = Array.isArray(saved.sources) && saved.sources.every((s) => typeof s === "string" && Object.hasOwn(SOURCE_LABELS, s))
          ? saved.sources as SourceId[] : undefined
        draftOptions.current = { ...(saved.tool ? { tool: parseToolIntent(JSON.stringify(saved.tool)) } : {}), mode: saved.mode, readSourcesOnly: saved.readSourcesOnly === true, ...(selected ? { sources: selected } : {}) }
        setSelectedTool(draftOptions.current.tool)
        if (draftOptions.current.tool) setToolPending(true)
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
    if (loaded) { try { sessionStorage.setItem(ACTIVE_CHAT_KEY, loaded.id) } catch {} }
    if (loaded?.projectId) {
      try { await getProjectRemote(loaded.projectId); setScopeError(null) }
      catch { setScopeError("This project's scope is unavailable. The transcript is preserved, but cannot continue.") }
    } else setScopeError(null)
    const bundle = await loadBundle(vault)
    if (mounted.current) setTitles(Object.fromEntries([...bundle.pages.values()].map((p) => [p.id, p.frontmatter.title])))
  }, [sessionId])
  useEffect(() => {
    let alive = true
    let resuming = false
    setLoading(true); setError(null)
    ;(async () => {
      try {
        if (sessionId) await reload()
        else {
          let activeId: string | null = null
          try {
            if (fresh) sessionStorage.removeItem(ACTIVE_CHAT_KEY)
            else if (resume) activeId = sessionStorage.getItem(ACTIVE_CHAT_KEY)
          } catch { /* Browser storage is optional; History remains available. */ }
          const sessions = await listSessions(await getOpenVault())
          if (!alive) return
          if (activeId && sessions.some((saved) => saved.id === activeId)) {
            resuming = true
            router.replace(`/chat/${activeId}`)
            return
          }
          if (activeId) { try { sessionStorage.removeItem(ACTIVE_CHAT_KEY) } catch {} }
          setRecent(sessions.slice(0, 8)); setSession(null)
        }
      } catch (e) { if (alive) { setError(sessionId ? "Conversation not found. It may have been removed or could not be read." : e instanceof Error ? e.message : String(e)); if (sessionId) setScopeError("Open a saved conversation from History or start a new chat.") } }
      finally { if (alive && !resuming) setLoading(false) }
    })()
    return () => { alive = false }
  }, [sessionId, fresh, resume, reload, router])

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
    if (!sessionId) return
    const controller = new AbortController()
    void observeSkillJob(`chat:${sessionId}`, async job => {
      if (sending.current || controller.signal.aborted) return
      if (job.status === "running") {
        setBusy(true)
        if (typeof job.progress?.text === "string") setDraft(job.progress.text)
        const value = job.progress?.stage
        setStage(typeof value === "string" && value in STAGE_LABELS ? value as ChatStage : null)
      } else {
        setBusy(false); setStage(null); setDraft("")
        if (job.status === "completed") await reload()
        else setError(job.error ?? "The response did not complete.")
      }
    }, controller.signal).catch(error => {
      if (!controller.signal.aborted && !sending.current) { setBusy(false); setError(String(error)) }
    })
    return () => controller.abort()
  }, [sessionId, reload])

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
    if (!q || busy || sending.current || scopeError || toolError || toolPending || (usesSourceScope && (!sources.length || sourcesError))) return
    sending.current = true; setBusy(true); setError(null); setStage(null); setDraft("")
    const id = sessionId ?? `chat_${crypto.randomUUID()}`
    // Remember the submitted conversation before waiting for its result, so
    // leaving during a response can reopen the server's saved pending turn.
    try { sessionStorage.setItem(ACTIVE_CHAT_KEY, id) } catch {}
    try { sessionStorage.setItem(`scispark:chat-draft:${id}:options`, JSON.stringify(draftOptions.current)) } catch {}
    try {
      if (mode === "review") {
        const run = await prepareReview({ sessionId: id, operationId: crypto.randomUUID(), question: q, sources })
        try { sessionStorage.removeItem(draftKey) } catch {}
        if (mounted.current) { setQuestion(""); if (sessionId) await reload(); else router.push(`/chat/${run.sessionId}`) }
        return
      }
      const result = await askChatRemote({ sessionId: id, question: q, readSourcesOnly: selectedTool ? false : readSourcesOnly, mode,
        ...(selectedTool ? { explicitTool: selectedTool } : {}),
        ...(usesSourceScope ? { sources } : {}), operationId: crypto.randomUUID(),
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

  function selectMode(next: "chat" | "search" | "review") {
    selectionOverride.current = {}
    setToolError(null); setToolPending(false)
    setSelectedTool(undefined); setMode(next); setReadSourcesOnly(false)
    saveDraftOptions({ mode: next, readSourcesOnly: false, tool: undefined })
  }

  function selectTool(tool: ToolRef) {
    selectionOverride.current = { tool }
    setToolError(null); setToolPending(false)
    setSelectedTool(tool); setMode("chat"); setReadSourcesOnly(false)
    saveDraftOptions({ mode: "chat", readSourcesOnly: false, tool })
  }

  if (!sessionId && !loading) return (
    <div data-chat-start className="flex min-h-full w-full flex-col px-4 py-4 sm:px-8 sm:py-6">
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4">
        <p className="font-heading text-[24px] text-espresso">Sparky</p>
        <Link href="/history?tab=conversations" className="inline-flex items-center gap-2 text-sm text-accent-ink"><Clock size={16} aria-hidden="true" />History</Link>
      </header>
      <section aria-label="Start a conversation" className="mx-auto my-auto w-full max-w-[760px] py-12 sm:py-16">
        <h1 className="mb-7 text-center font-heading text-[24px] leading-tight text-espresso sm:text-[38px]">What would you like to explore?</h1>
        {toolError && <p role="alert" className="mb-3 text-sm text-espresso">{toolError}</p>}
        {error && <div className="mb-3"><LlmErrorMessage message={error} /></div>}
        <Composer welcome value={question} onChange={changeQuestion} onSubmit={submit}
          busy={busy || toolPending || (usesSourceScope && (!sources.length || Boolean(sourcesError)))}
          placeholder={mode === "review" ? "What question should this literature review investigate?" : mode === "search" ? "Ask a research question to find papers…" : "Ask Sparky about your research…"} />
        <div aria-label="Research options" className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" aria-pressed={mode === "chat" && !selectedTool} disabled={busy} onClick={() => selectMode("chat")} className={`flex items-center gap-2 rounded-pill border px-3.5 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-accent-ink ${mode === "chat" && !selectedTool ? "border-accent-ink bg-light-surface text-accent-ink" : "border-border-warm text-muted-text"}`}><BookOpen size={16} aria-hidden="true" />Discuss research</button>
          {tools.map(tool => <button key={JSON.stringify(tool.ref)} type="button" aria-pressed={toolSelected(tool.ref)} disabled={busy || tool.readiness.status !== "ready"} onClick={() => selectTool(tool.ref)} className={`rounded-pill border px-3.5 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-accent-ink disabled:opacity-50 ${toolSelected(tool.ref) ? "border-accent-ink bg-light-surface text-accent-ink" : "border-border-warm text-muted-text hover:bg-light-surface hover:text-espresso"}`}>{tool.name}</button>)}
          <Link href="/tools" className="rounded-pill px-3.5 py-2.5 text-[13px] text-accent-ink">Tools</Link>
        </div>
        {(!selectedTool || usesSourceScope) && <details className="mt-5 text-[13px] text-muted-text">
          <summary className="mx-auto w-fit cursor-pointer rounded px-2 py-1 focus-visible:outline-2 focus-visible:outline-accent-ink">{usesSourceScope ? "Search scope" : "Conversation options"}</summary>
          <div className="mx-auto mt-3 w-full max-w-[440px]">
            {!usesSourceScope ? !selectedTool && <SourcesToggle value={readSourcesOnly} onChange={(value) => { setReadSourcesOnly(value); saveDraftOptions({ readSourcesOnly: value }) }} /> : <>
              <div className="flex flex-wrap gap-3">{enabledSources.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm text-espresso"><input type="checkbox" disabled={busy} checked={sources.includes(s)} onChange={() => { const next = sources.includes(s) ? sources.filter((p) => p !== s) : [...sources, s]; setSources(next); saveDraftOptions({ sources: next }) }} />{SOURCE_LABELS[s]}</label>)}</div>
              <button type="button" onClick={() => openSettings("sources")} className="mt-3 text-accent-ink">Manage sources</button>
            </>}
          </div>
        </details>}
        {usesSourceScope && sourcesError && <p role="alert" className="mt-3 text-sm text-espresso">{sourcesError} <button onClick={() => openSettings("sources")} className="text-accent-ink underline">Manage sources</button></p>}
        <p className="mt-4 text-center text-xs text-muted-text">Enter to send. Shift+Enter for a new line.</p>
        {busy && <div className="mt-6"><StreamingReply text={draft} label={stage ? STAGE_LABELS[stage] : "Thinking…"} /></div>}
        {recent.length > 0 && <details className="mt-8 border-t border-border-warm pt-4 text-sm text-muted-text">
          <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-accent-ink">Recent conversations</summary>
          <ul className="mt-2 divide-y divide-border-warm">{recent.slice(0, 4).map((s) => <li key={s.id}><Link className="block py-3 text-espresso hover:text-accent-ink" href={`/chat/${s.id}`}>{s.title}</Link></li>)}</ul>
        </details>}
      </section>
    </div>
  )

  return <div className="flex h-full min-h-0 w-full">
    <div className={`${reportId ? "hidden max-w-[520px] lg:flex" : "flex max-w-[1180px]"} mx-auto h-full min-h-0 min-w-0 w-full flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6`}>
    <header className="mb-4 flex shrink-0 flex-col items-start justify-between gap-3 border-b border-border-warm pb-4 sm:flex-row sm:gap-4">
      <div className="min-w-0"><h1 className="font-heading text-[28px] leading-tight text-espresso sm:text-[34px]">{reportId ? "Review conversation" : session?.title ?? "Sparky"}</h1>
        {!reportId && (session?.projectId || session?.paperContext) && (
          <p className="mt-1 text-sm text-muted-text">
            {session.projectId ? `Project · ${session.projectTitle}` : session.paperContext && <>
              Paper · <Link className="text-accent-ink hover:underline" href={`/paper/${session.paperContext.slug}`}>{session.paperContext.paper.title}</Link>
              {session.paperContext.source && <> · {session.paperContext.source.access === "full-text" ? session.paperContext.source.truncated ? "Full-text excerpt" : "Full text" : "Abstract only"}</>}
            </>}
          </p>
        )}</div>
      <nav className="flex shrink-0 flex-wrap gap-3 text-sm text-accent-ink"><Link href="/history?tab=conversations" className="inline-flex items-center gap-2"><Clock size={16} aria-hidden="true" />History</Link><Link href="/chat?new=1">New chat</Link></nav>
    </header>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1" aria-label="Conversation">
      {loading ? <LoadingState label="Loading conversation…" /> : session ? <MessageList messages={session.messages} pageTitleById={titles} onSaveMessage={save} savingIndex={savingIndex} /> : <div className="flex min-h-full flex-col justify-center py-6">
        <h2 className="font-heading text-[28px] text-espresso">What would you like to explore?</h2>
        {recent.length > 0 && <section className="mt-8"><h3 className="text-sm text-muted-text">Recent conversations</h3><ul className="mt-2 divide-y divide-border-warm">{recent.map((s) => <li key={s.id}><Link className="block py-3 text-sm text-espresso hover:text-accent-ink" href={`/chat/${s.id}`}>{s.title}</Link></li>)}</ul></section>}
      </div>}
      {busy && <div className="mt-4"><StreamingReply text={draft} label={stage ? STAGE_LABELS[stage] : "Thinking…"} /></div>}
    </div>
    <footer className="mt-4 shrink-0 border-t border-border-warm pt-3">
      {toolError && <p role="alert" className="mb-2 text-sm text-espresso">{toolError}</p>}
      {scopeError && <p role="alert" className="mb-2 text-sm text-espresso">{scopeError}</p>}
      {error && <LlmErrorMessage message={error} />}
      {savedPage && <p className="mb-2 text-sm text-muted-text">Added to your knowledge base. <Link className="text-accent-ink" href={wikiHref(savedPage)}>View page</Link></p>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-text">Mode <select aria-label="Chat mode" disabled={busy} value={selectedTool ? JSON.stringify(selectedTool) : mode} onChange={e => { if (e.target.value === "chat") selectMode("chat"); else selectTool(parseToolIntent(e.target.value)) }} className="ml-2 rounded-btn border border-border-warm bg-light-surface px-3 py-1.5 text-espresso"><option value="chat">Discuss research</option>{mode !== "chat" && <option value={mode}>{mode === "search" ? "Find papers" : "Deep literature review"}</option>}{tools.map(tool => <option key={JSON.stringify(tool.ref)} value={JSON.stringify(tool.ref)} disabled={tool.readiness.status !== "ready"}>{tool.name}</option>)}</select></label>
        <Link href="/tools" className="text-sm text-accent-ink">Tools</Link>
        {usesSourceScope ? <><button type="button" className="text-sm text-muted-text hover:text-accent-ink" aria-expanded={showSources} onClick={() => setShowSources(!showSources)}>Search scope</button><button type="button" onClick={() => openSettings("sources")} className="text-sm text-accent-ink">Manage sources</button></> : !selectedTool && <SourcesToggle value={readSourcesOnly} onChange={(value) => { setReadSourcesOnly(value); saveDraftOptions({ readSourcesOnly: value }) }} />}
      </div>
      {usesSourceScope && showSources && <div className="mb-3 flex flex-wrap gap-3">{enabledSources.map((s) => <label key={s} className="flex items-center gap-1.5 text-sm text-espresso"><input type="checkbox" disabled={busy} checked={sources.includes(s)} onChange={() => { const next = sources.includes(s) ? sources.filter((p) => p !== s) : [...sources, s]; setSources(next); saveDraftOptions({ sources: next }) }} />{SOURCE_LABELS[s]}</label>)}</div>}
      {usesSourceScope && sourcesError && <p role="alert" className="mb-2 text-sm text-espresso">{sourcesError}</p>}
      <Composer value={question} onChange={changeQuestion} onSubmit={submit} busy={busy || toolPending || loading || Boolean(scopeError) || (usesSourceScope && (!sources.length || Boolean(sourcesError)))} placeholder={mode === "review" ? "What question should this literature review investigate?" : mode === "search" ? "Ask a research question to find papers…" : "Ask about your research or the papers above…"} />
      <p className="mt-2 text-xs text-muted-text">Enter to send. Shift+Enter for a new line.</p>
    </footer>
    </div>
    {reportId && <ReviewReport key={`${reportId}:${reportVersion ?? "latest"}`} id={reportId} initialVersion={reportVersion} onClose={() => setReportId(null)} />}
  </div>
}
