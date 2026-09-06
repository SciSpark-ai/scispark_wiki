"use client"

import { Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowUp, Check, ChevronDown, Loader2, Search, Sparkles } from "lucide-react"
import type { PaperRecord, SourceId } from "@/lib/papers/types"
import {
  RESEARCH_SEARCH_SOURCES,
  type ResearchSearchResult,
  type ResearchSearchStage,
} from "@/lib/skills/research-search-contract"
import { researchSearchRemote } from "@/lib/skills/research-search-client"
import { getOpenVault } from "@/lib/vault/get-vault"
import { resolvePaperByKey } from "@/lib/papers/resolve"
import { logEvent } from "@/lib/events/log"
import { writeReaderHandoff } from "@/lib/reader/handoff"
import { paperSlug } from "@/lib/wiki/authoring"
import { COMPANION_CLEARANCE } from "@/components/layout/companion-clearance"
import { ResearchSearchResultItem } from "@/components/papers/ResearchSearchResultItem"
import { LlmErrorMessage } from "@/components/papers/LlmErrorMessage"
import { PageHeader } from "@/components/ui/PageHeader"
import { LoadingState } from "@/components/ui/LoadingState"

const SOURCE_LABELS: Record<SourceId, string> = {
  arxiv: "arXiv",
  openalex: "OpenAlex",
  s2: "Semantic Scholar",
  pubmed: "PubMed",
}

const EXAMPLE_QUESTIONS = [
  "Recent RCTs on conversational agents in pediatric care",
  "Compare methods for auditory attention decoding",
  "Reviews of multimodal speech assessment",
]

const STAGE_LABELS: Record<ResearchSearchStage, string> = {
  planning: "Understanding your question",
  searching: "Searching the literature",
  ranking: "Reading and ranking the strongest matches",
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function SearchProgress({ stage, elapsed }: { stage: ResearchSearchStage; elapsed: number }) {
  const stages = Object.keys(STAGE_LABELS) as ResearchSearchStage[]
  const activeIndex = stages.indexOf(stage)
  return (
    <section className="mt-8 border-y border-border-warm py-6" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 size={18} className="animate-spin text-orange motion-reduce:animate-none" aria-hidden="true" />
        <p className="font-heading text-[21px] text-espresso">{STAGE_LABELS[stage]}</p>
        <span className="ml-auto text-[12px] text-muted-text">{elapsed}s</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {stages.map((item, index) => (
          <div key={item} className="flex items-center gap-2 text-[12px]">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${index < activeIndex ? "border-orange bg-orange text-white" : index === activeIndex ? "border-orange text-orange" : "border-border-warm text-muted-text"}`}>
              {index < activeIndex ? <Check size={12} aria-hidden="true" /> : <span className={`h-1.5 w-1.5 rounded-full ${index === activeIndex ? "bg-orange" : "bg-border-warm"}`} />}
            </span>
            <span className={index <= activeIndex ? "text-espresso" : "text-muted-text"}>{STAGE_LABELS[item]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function PapersPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const [query, setQuery] = useState("")
  const [sources, setSources] = useState<SourceId[]>([...RESEARCH_SEARCH_SOURCES])
  const [showScope, setShowScope] = useState(false)
  const [stage, setStage] = useState<ResearchSearchStage | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [result, setResult] = useState<ResearchSearchResult | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (!stage) return
    const startedAt = Date.now()
    setElapsed(0)
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(interval)
  }, [stage])

  useEffect(() => {
    const key = searchParams.get("paperKey")
    if (!key) return
    let cancelled = false
    ;(async () => {
      try {
        const vault = await getOpenVault()
        const paper = await resolvePaperByKey(vault, key)
        if (cancelled || !paper) return
        await writeReaderHandoff(vault, paper)
        if (!cancelled) router.replace(`/paper/${encodeURIComponent(paperSlug(paper))}`)
      } catch {
        // Best-effort compatibility redirect.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [searchParams, router])

  async function runSearch() {
    const normalizedQuery = query.trim()
    if (!normalizedQuery || stage) return
    setStage("planning")
    setElapsed(0)
    setSearchError(null)
    setResult(null)
    try {
      const nextResult = await researchSearchRemote(
        { query: normalizedQuery, sources },
        (nextStage) => setStage(nextStage),
      )
      setResult(nextResult)
      void getOpenVault().then((vault) => Promise.all(nextResult.plan.queries.map((planned) =>
        logEvent(vault, { type: "search", source: planned.source, query: planned.query, sort: nextResult.plan.sort }),
      )))
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error))
    } finally {
      setStage(null)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void runSearch()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void runSearch()
    }
  }

  function toggleSource(source: SourceId) {
    setSources((current) => {
      if (current.includes(source)) {
        return current.length === 1 ? current : current.filter((item) => item !== source)
      }
      return [...current, source]
    })
  }

  function fillExample(example: string) {
    setQuery(example)
    composerRef.current?.focus()
  }

  async function handleOpenPaper(paper: PaperRecord) {
    try {
      const vault = await getOpenVault()
      await writeReaderHandoff(vault, paper)
    } catch {
      // The paper page still tries feed/wiki resolution if the handoff fails.
    }
    router.push(`/paper/${encodeURIComponent(paperSlug(paper))}`)
  }

  const allSources = sources.length === RESEARCH_SEARCH_SOURCES.length

  return (
    <div className={`px-5 py-7 sm:px-8 lg:px-10 lg:py-9 ${COMPANION_CLEARANCE}`}>
      <div className="mx-auto max-w-[1180px]">
        <PageHeader
          title="Search"
          description="Ask a research question. Sparky will plan the search, choose the right indexes, and rank what it finds."
          actions={<Link href="/wiki/inbox" className="rounded-pill border border-border-warm px-3 py-1.5 text-[13px] text-espresso hover:border-orange/50">Review inbox</Link>}
        />

        <form onSubmit={handleSubmit} className="mt-7 overflow-hidden rounded-[24px] border border-border-warm bg-light-surface">
          <div className="flex items-start gap-3 px-5 pb-4 pt-5 sm:px-7 sm:pt-6">
            <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange text-white">
              <Sparkles size={17} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <label htmlFor="research-search" className="font-heading text-[22px] text-espresso sm:text-[25px]">
                What do you want to understand?
              </label>
              <textarea
                ref={composerRef}
                id="research-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="For example: Which interventions improve conversational turn-taking in autistic children?"
                maxLength={512}
                rows={3}
                className="mt-3 block w-full resize-none bg-transparent text-[15px] leading-relaxed text-espresso outline-none placeholder:text-muted-text"
              />
            </div>
            <button
              type="submit"
              disabled={Boolean(stage) || !query.trim()}
              className="mt-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange text-white transition-colors hover:bg-orange/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange/50"
              aria-label={stage ? "Search in progress" : "Search with Sparky"}
            >
              {stage ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowUp size={20} aria-hidden="true" />}
            </button>
          </div>

          <div className="border-t border-border-warm px-5 py-3 sm:px-7">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowScope((open) => !open)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-secondary-dark hover:text-orange"
                aria-expanded={showScope}
              >
                Search scope: {allSources ? "all sources" : `${sources.length} selected`}
                <ChevronDown size={14} className={showScope ? "rotate-180" : ""} aria-hidden="true" />
              </button>
              <span className="ml-auto hidden text-[11px] text-muted-text sm:inline">⌘ Enter to search</span>
            </div>
            {showScope && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSources([...RESEARCH_SEARCH_SOURCES])}
                  aria-pressed={allSources}
                  className={`rounded-pill border px-3 py-1.5 text-[12px] ${allSources ? "border-orange bg-orange text-white" : "border-border-warm text-secondary-dark hover:border-orange/50"}`}
                >
                  All sources
                </button>
                {RESEARCH_SEARCH_SOURCES.map((source) => {
                  const active = sources.includes(source)
                  return (
                    <button
                      key={source}
                      type="button"
                      onClick={() => toggleSource(source)}
                      aria-pressed={active}
                      className={`rounded-pill border px-3 py-1.5 text-[12px] ${active ? "border-orange bg-card-surface text-espresso" : "border-border-warm text-muted-text hover:border-orange/50"}`}
                    >
                      {SOURCE_LABELS[source]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </form>

        {!result && !stage && !searchError && (
          <section className="mt-7 grid gap-7 border-t border-border-warm pt-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <p className="text-[13px] font-medium text-espresso">Try a question</p>
              <div className="mt-2 divide-y divide-border-warm border-y border-border-warm">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button key={example} type="button" onClick={() => fillExample(example)} className="flex w-full items-center gap-3 py-3 text-left text-[13px] text-secondary-dark hover:text-orange">
                    <Search size={14} className="shrink-0 text-muted-text" aria-hidden="true" />
                    {example}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-text">
              Sparky uses your research profile to clarify terminology, then searches several scholarly indexes and explains why each result belongs. Your question stays primary.
            </p>
          </section>
        )}

        {stage && <SearchProgress stage={stage} elapsed={elapsed} />}
        {searchError && <LlmErrorMessage message={searchError} />}

        {result && (
          <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_310px] lg:items-start">
            <section>
              <div className="border-b border-border-warm pb-4">
                <p className="font-heading text-[25px] leading-tight text-espresso">
                  {result.items.length} {result.items.length === 1 ? "paper" : "papers"} for “{result.plan.interpretation}”
                </p>
                <p className="mt-2 text-[12px] text-muted-text">
                  {result.stats.retrieved} records found · {result.stats.deduplicated} unique · ranked for this question
                </p>
              </div>
              {result.warnings.map((warning) => (
                <p key={warning} className="mt-4 border-l-2 border-orange pl-3 text-[12px] leading-relaxed text-muted-text">{warning}</p>
              ))}
              <div className="mt-5">
                {result.items.map((item, index) => (
                  <ResearchSearchResultItem
                    key={item.paper.ids.doi ?? item.paper.ids.arxiv ?? item.paper.ids.pmid ?? item.paper.ids.s2 ?? item.paper.ids.openalex ?? item.paper.title}
                    item={item}
                    index={index}
                    onSelect={() => void handleOpenPaper(item.paper)}
                  />
                ))}
              </div>
            </section>

            <aside className="rounded-[18px] border border-border-warm bg-light-surface p-5 lg:sticky lg:top-6">
              <h2 className="font-heading text-[21px] text-espresso">Search brief</h2>
              <div className="mt-4 space-y-5 text-[13px]">
                <div>
                  <p className="font-medium text-secondary-dark">What Sparky understood</p>
                  <p className="mt-1 leading-relaxed text-muted-text">{result.plan.interpretation}</p>
                </div>
                <div>
                  <p className="font-medium text-secondary-dark">Ordering</p>
                  <p className="mt-1 text-muted-text">{result.plan.sort === "date" ? "Newest strong matches first" : "Strongest matches first"}</p>
                  <p className="mt-1 text-muted-text">{result.plan.fromDate ? `Published since ${formatDate(result.plan.fromDate)}` : "No date limit"}</p>
                </div>
                <div>
                  <p className="font-medium text-secondary-dark">Queries searched</p>
                  <div className="mt-2 space-y-3">
                    {result.plan.queries.map((planned) => (
                      <div key={`${planned.source}:${planned.query}`} className="border-t border-border-warm pt-3 first:border-t-0 first:pt-0">
                        <p className="text-[11px] font-medium text-orange">{SOURCE_LABELS[planned.source]}</p>
                        <p className="mt-1 leading-snug text-espresso">{planned.query}</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-text">{planned.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PapersPage() {
  return (
    <Suspense fallback={<div className="p-7"><LoadingState /></div>}>
      <PapersPageContent />
    </Suspense>
  )
}
