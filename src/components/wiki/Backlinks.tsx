"use client"

import Link from "next/link"
import { backlinks, type Bundle } from "@/lib/vault/bundle"
import { wikiHref } from "@/lib/wiki/href"

interface BacklinksProps {
  bundle: Bundle
  id: string
}

export function Backlinks({ bundle, id }: BacklinksProps) {
  const sources = backlinks(bundle, id)

  if (sources.length === 0) {
    return <p className="text-[13px] text-muted-text">No backlinks yet.</p>
  }

  return (
    <ul className="space-y-1.5">
      {sources.map((sourceId) => {
        const page = bundle.pages.get(sourceId)
        return (
          <li key={sourceId}>
            <Link href={wikiHref(sourceId)} className="text-[13px] text-accent-ink hover:underline">
              {page?.frontmatter.title ?? sourceId}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
