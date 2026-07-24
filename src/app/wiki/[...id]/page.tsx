"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { serializeDocument } from "@/lib/vault/frontmatter"
import { displayTitle } from "@/lib/papers/title"
import { wikiHref, resolveWikiRouteId } from "@/lib/wiki/href"
import { isDeletablePage, backlinkCount, deletePage } from "@/lib/wiki/delete"
import type { VaultStorage } from "@/lib/vault/storage"
import type { WikiPage } from "@/lib/vault/types"
import { PageEditor } from "@/components/wiki/PageEditor"
import { Backlinks } from "@/components/wiki/Backlinks"
import DeleteConfirmCard from "@/components/wiki/DeleteConfirmCard"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function WikiPageDetail() {
  const params = useParams()
  const router = useRouter()
  // Next 16 catch-all ([...id]): params.id is always string[] for a
  // required catch-all segment. Joined back into URL segments, then resolved
  // to the vault-relative bundle id (e.g. "wiki/concepts/foo") via the
  // shared helper — this accepts BOTH the canonical URL ("concepts/foo")
  // and legacy doubled links ("wiki/concepts/foo"), per C5.
  const rawId = params?.id
  const joined = Array.isArray(rawId) ? rawId.join("/") : (rawId ?? "")
  const id = resolveWikiRouteId(joined)

  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  // undefined = still loading, null = loaded but not found
  const [page, setPage] = useState<WikiPage | null | undefined>(undefined)
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const vault = await getOpenVault()
    setStorage(vault)
    const b = await loadBundle(vault)
    setBundle(b)
    const p = b.pages.get(id) ?? null
    setPage(p)
    setBody(p?.body ?? "")
  }, [id])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        await load()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [load])

  // Legacy doubled links (/wiki/wiki/...) — settle on the canonical URL.
  useEffect(() => {
    if (joined.startsWith("wiki/")) router.replace(wikiHref(id))
  }, [joined, id, router])

  const handleSave = async () => {
    if (!storage || !page) return
    try {
      const updatedFrontmatter = { ...page.frontmatter, updated: today() }
      const content = serializeDocument(updatedFrontmatter, body)
      await storage.write(page.path, content)
      setStatus("Saved")
      await load()
      setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleConfirmDelete = async () => {
    if (!storage || !page) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deletePage(storage, page)
      router.push("/wiki")
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  if (page === undefined) {
    return <div className="p-7 text-[14px] text-muted-text">Loading…</div>
  }

  if (page === null) {
    return (
      <div className="p-7">
        <p className="text-[14px] text-espresso">Page not found: {id}</p>
        {error && <p className="mt-2 text-[13px] text-red-600">Error: {error}</p>}
        <Link href="/wiki" className="mt-3 inline-block text-[14px] text-orange hover:underline">
          ← Back to wiki
        </Link>
      </div>
    )
  }

  const fm = page.frontmatter
  const slug = page.id.split("/").pop() ?? page.id
  const canDelete = isDeletablePage(page)

  return (
    <div className="p-7 flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-3">
          <Link href="/wiki" className="text-[13px] text-muted-text hover:text-espresso">
            ← Wiki
          </Link>
          <div className="flex items-center gap-3">
            {status && <span className="text-[13px] text-orange">{status}</span>}
            {error && <span className="text-[13px] text-red-600">{error}</span>}
            {fm.type === "paper" && (
              <Link href={`/paper/${slug}`} className="text-[13px] text-orange hover:underline">
                Open paper page →
              </Link>
            )}
            <button
              onClick={handleSave}
              className="text-[13px] text-white bg-orange hover:bg-orange/90 rounded-pill px-4 py-1.5 font-medium transition-colors"
            >
              Save
            </button>
            {canDelete && (
              <button
                onClick={() => {
                  setDeleteError(null)
                  setConfirmingDelete(true)
                }}
                className="text-[13px] text-espresso hover:text-red-600 rounded-pill border border-border-warm px-4 py-1.5 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {confirmingDelete && (
          <DeleteConfirmCard
            title={displayTitle(String(fm.title ?? ""))}
            backlinks={bundle ? backlinkCount(bundle, page.id) : 0}
            busy={deleteBusy}
            error={deleteError}
            onConfirm={handleConfirmDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        )}

        <h1 className="font-heading text-[24px] text-espresso tracking-heading">{displayTitle(String(fm.title ?? ""))}</h1>

        <div className="flex flex-wrap items-center gap-2 mt-3 mb-5">
          <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-espresso">
            {fm.type}
          </span>
          {fm.type === "idea" && typeof fm.status === "string" && (
            <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-espresso">
              {fm.status}
            </span>
          )}
          {fm.type === "idea" && typeof fm.depth === "string" && (
            <span className="text-[12px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-light-surface border border-border-warm text-muted-text">
              {fm.depth}
            </span>
          )}
          {fm.tags.map((tag) => (
            <span key={tag} className="text-[12px] px-2 py-0.5 rounded-pill bg-light-surface border border-border-warm text-muted-text">
              #{tag}
            </span>
          ))}
          <span className="text-[12px] text-muted-text">updated {fm.updated}</span>
          <span className="text-[12px] text-muted-text">
            {fm.sources.length} source{fm.sources.length === 1 ? "" : "s"}
          </span>
        </div>

        {bundle && <PageEditor value={body} onChange={setBody} bundle={bundle} />}
      </div>

      <aside className="w-full lg:w-64 flex-shrink-0">
        <h2 className="text-[13px] font-medium text-espresso tracking-body mb-2">Backlinks</h2>
        {bundle && <Backlinks bundle={bundle} id={id} />}
      </aside>
    </div>
  )
}
