"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getOpenVault } from "@/lib/vault/get-vault"
import { loadBundle, type Bundle } from "@/lib/vault/bundle"
import { reviewCount } from "@/lib/wiki/review-queue"
import { composePage } from "@/lib/wiki/authoring"
import type { VaultStorage } from "@/lib/vault/storage"
import { Tree } from "@/components/wiki/Tree"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function WikiIndexPage() {
  const router = useRouter()
  const [storage, setStorage] = useState<VaultStorage | null>(null)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [inboxCount, setInboxCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const vault = await getOpenVault()
    setStorage(vault)
    const [b, n] = await Promise.all([loadBundle(vault), reviewCount(vault)])
    setBundle(b)
    setInboxCount(n)
  }, [])

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
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
      router.push(`/wiki/${path.slice(0, -".md".length)}`)
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="p-7">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="font-heading text-[28px] text-espresso tracking-heading">Wiki</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/wiki/inbox"
            className="text-[13px] text-muted-text hover:text-espresso tracking-body px-3 py-1.5 rounded-pill border border-border-warm"
          >
            Review inbox ({inboxCount})
          </Link>
          <button
            onClick={handleNewNote}
            disabled={busy || !storage}
            className="text-[13px] text-white bg-orange hover:bg-orange/90 disabled:opacity-50 rounded-pill px-4 py-1.5 font-medium transition-colors"
          >
            New note
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-[13px] text-red-600">Error: {error}</p>
      )}

      {!bundle ? (
        <p className="mt-6 text-[14px] text-muted-text">Loading vault…</p>
      ) : (
        <>
          <div className="mt-6">
            <Tree bundle={bundle} />
          </div>


          {bundle.errors.length > 0 && (
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
        </>
      )}
    </div>
  )
}
