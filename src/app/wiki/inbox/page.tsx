"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { listReviews, dismissReview, type ReviewItem } from "@/lib/wiki/review-queue"
import { loadBundle, resolveLink, type Bundle } from "@/lib/vault/bundle"

const KIND_LABEL: Record<ReviewItem["kind"], string> = {
  contradiction: "Contradiction",
  duplicate: "Duplicate",
  "missing-page": "Missing page",
  suggestion: "Suggestion",
  "lint-finding": "Lint",
}

/** wiki page id (e.g. "wiki/papers/foo") -> the /wiki/<...> route for it. */
function pageHref(id: string): string {
  return `/wiki/${id}` // full id in URL: the /wiki/[...id] route joins segments back to the bundle id (e.g. /wiki/wiki/concepts/foo)
}

export default function WikiInboxPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ReviewItem[]>([])
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [dismissing, setDismissing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const vault = await getOpenVault()
      const [reviews, b] = await Promise.all([listReviews(vault), loadBundle(vault)])
      setItems(reviews)
      setBundle(b)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleDismiss(id: string) {
    setDismissing(id)
    try {
      const vault = await getOpenVault()
      await dismissReview(vault, id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDismissing(null)
    }
  }

  return (
    <div className="p-7">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">Review inbox</h1>
        <Link href="/wiki" className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1">
          Back to wiki
        </Link>
      </div>

      {error && (
        <div className="mt-4 border border-border-warm rounded-card px-3 py-2 bg-light-surface text-[13px] text-espresso">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-[13px] text-muted-text tracking-body">Loading…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] text-muted-text tracking-body">Nothing needs review right now.</p>
          <Link
            href="/wiki"
            className="mt-4 text-[14px] text-orange font-medium tracking-body hover:text-orange-light transition-colors"
          >
            Back to wiki →
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="border border-border-warm rounded-card px-3 py-2 bg-light-surface">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded-pill bg-card-surface text-muted-text">
                  {KIND_LABEL[item.kind]}
                </span>
                <button
                  type="button"
                  onClick={() => handleDismiss(item.id)}
                  disabled={dismissing === item.id}
                  className="text-[13px] text-espresso rounded-pill border border-border-warm px-3 py-1 disabled:opacity-50"
                >
                  {dismissing === item.id ? "Dismissing…" : "Dismiss"}
                </button>
              </div>

              <div className="mt-2 font-heading text-[16px] text-espresso tracking-heading-card">{item.title}</div>
              <div className="mt-1 text-[13px]/[14px] text-muted-text">{item.description}</div>

              {item.pages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.pages.map((slug) => {
                    const page = bundle ? resolveLink(bundle, slug) : null
                    return page ? (
                      <Link key={slug} href={pageHref(page.id)} className="text-[12px] text-orange hover:text-orange-light">
                        {page.frontmatter.title}
                      </Link>
                    ) : (
                      <Link
                        key={slug}
                        href="/wiki"
                        className="text-[12px] text-muted-text"
                        title="page not found in the current wiki — links to the wiki index"
                      >
                        {slug} (unresolved)
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
