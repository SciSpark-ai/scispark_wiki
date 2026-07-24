"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { reviewCount } from "@/lib/wiki/review-queue"
import { composePage } from "@/lib/wiki/authoring"
import { wikiHref } from "@/lib/wiki/href"
import { deriveWikiDashboard, type PaperShelfStatus, type ShelfEntry } from "@/lib/wiki/dashboard"
import { displayTitle } from "@/lib/papers/title"
import type { VaultStorage } from "@/lib/vault/storage"
import { Tree } from "@/components/wiki/Tree"
import { PageHeader } from "@/components/ui/PageHeader"
import { Button } from "@/components/ui/Button"
import { Card } from "@/components/ui/Card"
import { Chip } from "@/components/ui/Chip"
import { EmptyState } from "@/components/ui/EmptyState"
import { StatsStrip } from "@/components/wiki/dashboard/StatsStrip"
import { Shelf } from "@/components/wiki/dashboard/Shelf"
import { TypeSections } from "@/components/wiki/dashboard/TypeSections"
import { RecentStrip } from "@/components/wiki/dashboard/RecentStrip"
import { COMPANION_CLEARANCE } from "@/components/layout/companion-clearance"
import { LoadingState } from "@/components/ui/LoadingState"
import { cn } from "@/components/ui/cn"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const SHELF_LABELS: Record<PaperShelfStatus, string> = {
  saved: "Saved",
  enriched: "Enriched",
  ingested: "In knowledge base",
}
const SHELF_ORDER: PaperShelfStatus[] = ["saved", "enriched", "ingested"]

/** Same card layout as Shelf's own cards, laid out in a wrapping grid
 * instead of a horizontal-scroll strip — used for the "View all" drill-down
 * on a single shelf. */
function ShelfListCard({ entry }: { entry: ShelfEntry }) {
  return (
    <Link href={`/paper/${entry.slug}`} className="block">
      <Card className="flex h-full flex-col gap-2 p-3 hover:bg-card-surface/50 transition-colors">
        <div className="font-heading text-[14px] text-espresso tracking-heading-card leading-snug line-clamp-2">
          {displayTitle(entry.title)}
        </div>
        {entry.tldr && (
          <p className="text-[12px] leading-[1.5] text-muted-text tracking-body line-clamp-2">{entry.tldr}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <span className="rounded-pill bg-card-surface px-2 py-0.5 text-[11px] uppercase tracking-wide text-espresso">
            {entry.status}
          </span>
          {entry.tags.slice(0, 3).map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>
      </Card>
    </Link>
  )
}

function WikiIndexPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const view = searchParams.get("view") === "all" ? "all" : "dashboard"

  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [viewAllShelf, setViewAllShelf] = useState<PaperShelfStatus | null>(null)

  const refresh = useCallback(async () => {
    const vault = await getOpenVault()
    setStorage(vault)
    const [b, n] = await Promise.all([loadBundle(vault), reviewCount(vault)])
    setBundle(b)
    setInboxCount(n)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const handleNewNote = async () => {
    if (!storage) return
    setBusy(true)
    try {
      const day = today()
      const path = `wiki/notes/note-${Date.now()}.md`
      const content = composePage({
        path,
        frontmatter: {
          type: "note",
          title: "Untitled note",
          created: day,
          updated: day,
          tags: [],
          related: [],
          sources: [],
        },
        body: "# Untitled note\n",
      })
      await storage.write(path, content)
      router.push(wikiHref(path))
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Any navigation that changes the `view` query param (Dashboard/All pages
  // toggle, TypeSections' "All ->" link, browser Back/Forward) should drop a
  // stale shelf drill-down rather than leaving it stranded — derive the reset
  // from the URL instead of scattering onClick handlers across every link
  // that can change `view`. React's sanctioned "adjust state during render"
  // idiom (track the previous value in state, compare during render) avoids
  // both the react-hooks/set-state-in-effect lint rule and the one-frame
  // stale-drilldown flash a useEffect reset would otherwise show.
  const [prevView, setPrevView] = useState(view)
  if (view !== prevView) {
    setPrevView(view)
    setViewAllShelf(null)
  }

  const dashboard = useMemo(() => (bundle ? deriveWikiDashboard(bundle) : null), [bundle])

  const shelfAllEntries = useMemo(() => {
    if (!bundle || !viewAllShelf) return null
    return deriveWikiDashboard(bundle, { shelfLimit: Infinity }).shelves[viewAllShelf]
  }, [bundle, viewAllShelf])

  const isEmpty = bundle !== null && bundle.pages.size === 0

  return (
    <div className={`p-7 ${COMPANION_CLEARANCE}`}>
      <PageHeader
        title="Wiki"
        actions={
          <>
            {!isEmpty && (
              <div className="flex items-center gap-0.5 rounded-pill border border-border-warm p-0.5">
                <Link
                  href="/wiki"
                  className={cn(
                    "rounded-pill px-3 py-1 text-[13px] tracking-body transition-colors",
                    view === "dashboard" ? "bg-orange text-white" : "text-muted-text hover:text-espresso",
                  )}
                >
                  Dashboard
                </Link>
                <Link
                  href="/wiki?view=all"
                  className={cn(
                    "rounded-pill px-3 py-1 text-[13px] tracking-body transition-colors",
                    view === "all" ? "bg-orange text-white" : "text-muted-text hover:text-espresso",
                  )}
                >
                  All pages
                </Link>
              </div>
            )}
            <Link
              href="/wiki/inbox"
              className="text-[13px] text-muted-text hover:text-espresso tracking-body px-3 py-1.5 rounded-pill border border-border-warm"
            >
              Review inbox ({inboxCount})
            </Link>
            <Button onClick={handleNewNote} disabled={busy || !storage}>
              New note
            </Button>
          </>
        }
      />

      {error && (
        <p className="mt-3 text-[13px] text-red-600">Error: {error}</p>
      )}

      {!bundle ? (
        <LoadingState label="Loading vault…" />
      ) : isEmpty ? (
        <EmptyState
          title="Your wiki is empty"
          hint="Search for papers to start building your knowledge base."
          action={
            <Link href="/papers" className="text-[13px] text-orange hover:text-orange-light">
              Search for papers →
            </Link>
          }
        />
      ) : view === "all" ? (
        <div className="mt-6">
          <Tree bundle={bundle} />
        </div>
      ) : (
        dashboard && (
          <div className="mt-6 space-y-8">
            <StatsStrip stats={dashboard.stats} inboxCount={inboxCount} />

            {viewAllShelf && shelfAllEntries ? (
              <section>
                <button
                  type="button"
                  onClick={() => setViewAllShelf(null)}
                  className="mb-3 text-[13px] text-orange hover:underline"
                >
                  ← Back to dashboard
                </button>
                <h2 className="mb-3 text-[13px] font-medium text-espresso tracking-body">
                  {SHELF_LABELS[viewAllShelf]} <span className="text-muted-text">({shelfAllEntries.length})</span>
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {shelfAllEntries.map((entry) => (
                    <ShelfListCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </section>
            ) : (
              SHELF_ORDER.map((status) => (
                <Shelf
                  key={status}
                  label={SHELF_LABELS[status]}
                  entries={dashboard.shelves[status]}
                  total={dashboard.stats.papers[status]}
                  onViewAll={() => setViewAllShelf(status)}
                />
              ))
            )}

            <TypeSections sections={dashboard.sections} />

            {dashboard.recent.length > 0 && (
              <section>
                <h2 className="mb-2 text-[13px] font-medium text-espresso tracking-body">Recent activity</h2>
                <RecentStrip recent={dashboard.recent} />
              </section>
            )}
          </div>
        )
      )}

      {bundle && bundle.errors.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[16px] font-heading text-espresso tracking-heading-card mb-3">Vault errors</h2>
          <ul className="space-y-1.5">
            {bundle.errors.map((err, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="flex-shrink-0 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text">
                  {err.kind}
                </span>
                <span className="text-espresso">
                  {err.path}: {err.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default function WikiIndexPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading vault…" />}>
      <WikiIndexPageContent />
    </Suspense>
  )
}
