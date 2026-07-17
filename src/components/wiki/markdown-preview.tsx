// Milkdown deviation (see PageEditor.tsx doc comment): this is the "light
// markdown renderer" the M4 task-9 brief allows as a fallback preview. It is
// intentionally minimal — headings, paragraphs, lists, code fences, and the
// four inline forms (code/link/bold/italic) — not a full CommonMark engine.
"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { resolveLink, type Bundle } from "@/lib/vault/bundle"
import { wikiHref } from "@/lib/wiki/href"

// Mirrors the shape of vault/wikilinks.ts's WIKILINK_RE (slug + optional
// |label), but as a *replace* pattern rather than an *extract* pattern —
// this needs the full match text back so unresolved links can be left as
// literal `[[slug]]` text per the brief's "simplest" guidance.
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g
// Same fence/inline-code shapes as wikilinks.ts, used here to build skip
// ranges so a `[[...]]`-looking string inside a code span isn't rewritten.
const CODE_REGION_RE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g

/**
 * Rewrites `[[slug]]` / `[[slug|label]]` wikilinks in `body` into standard
 * markdown links `[label](/wiki/<resolved id>)`, resolved against `bundle`.
 * Unresolved slugs are left as literal `[[slug]]` text (brief's minimum
 * viable behavior). Wikilinks inside fenced or inline code are left alone.
 * This only affects the *preview* — the raw textarea value (and what gets
 * saved) keeps the original wikilink syntax untouched.
 */
export function preprocessWikilinks(body: string, bundle: Bundle): string {
  const skipRanges: Array<[number, number]> = []
  for (const m of body.matchAll(CODE_REGION_RE)) {
    skipRanges.push([m.index, m.index + m[0].length])
  }
  const inSkipRange = (idx: number) => skipRanges.some(([s, e]) => idx >= s && idx < e)

  return body.replace(WIKILINK_RE, (match, rawSlug: string, rawLabel: string | undefined, offset: number) => {
    if (inSkipRange(offset)) return match
    const slug = rawSlug.trim()
    const target = resolveLink(bundle, slug)
    if (!target) return match
    const label = (rawLabel ?? slug).trim() || slug
    return `[${label}](${wikiHref(target.id)})`
  })
}

const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let i = 0
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > lastIndex) nodes.push(text.slice(lastIndex, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1] !== undefined) {
      nodes.push(
        <code key={key} className="px-1 py-0.5 bg-card-surface rounded-[4px] text-[13px] font-mono">
          {m[1]}
        </code>,
      )
    } else if (m[2] !== undefined) {
      const href = m[3]
      nodes.push(
        href.startsWith("/") ? (
          <Link key={key} href={href} className="text-orange hover:underline">
            {m[2]}
          </Link>
        ) : (
          <a key={key} href={href} target="_blank" rel="noreferrer" className="text-orange hover:underline">
            {m[2]}
          </a>
        ),
      )
    } else if (m[4] !== undefined) {
      nodes.push(<strong key={key}>{m[4]}</strong>)
    } else if (m[5] !== undefined) {
      nodes.push(<em key={key}>{m[5]}</em>)
    }
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

const HEADING_SIZES = ["text-[22px]", "text-[19px]", "text-[17px]", "text-[15px]", "text-[14px]", "text-[13px]"]

function Heading({ level, children }: { level: number; children: ReactNode }) {
  const className = `font-heading text-espresso tracking-heading mt-4 mb-2 ${HEADING_SIZES[level - 1] ?? HEADING_SIZES[5]}`
  switch (level) {
    case 1: return <h1 className={className}>{children}</h1>
    case 2: return <h2 className={className}>{children}</h2>
    case 3: return <h3 className={className}>{children}</h3>
    case 4: return <h4 className={className}>{children}</h4>
    case 5: return <h5 className={className}>{children}</h5>
    default: return <h6 className={className}>{children}</h6>
  }
}

const HEADING_LINE_RE = /^(#{1,6})\s+(.+)$/
const LIST_LINE_RE = /^([-*]|\d+\.)\s+(.+)$/

/** Renders `markdown` as React nodes. See module doc comment for scope. */
export function renderMarkdown(markdown: string): ReactNode {
  const lines = markdown.split("\n")
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === "") {
      i++
      continue
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      i++ // consume closing fence (or end of input if unterminated)
      blocks.push(
        <pre key={`b-${key++}`} className="bg-card-surface rounded-[6px] p-3 overflow-x-auto text-[13px] font-mono my-2">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      continue
    }

    const heading = HEADING_LINE_RE.exec(line)
    if (heading) {
      const level = heading[1].length
      blocks.push(
        <Heading key={`b-${key}`} level={level}>
          {renderInline(heading[2], `h-${key++}`)}
        </Heading>,
      )
      i++
      continue
    }

    const firstList = LIST_LINE_RE.exec(line)
    if (firstList) {
      const ordered = /^\d+\./.test(firstList[1])
      const items: string[] = []
      while (i < lines.length) {
        const m2 = LIST_LINE_RE.exec(lines[i])
        if (!m2) break
        items.push(m2[2])
        i++
      }
      const listClass = `${ordered ? "list-decimal" : "list-disc"} pl-5 my-2 text-[14px] text-espresso tracking-body space-y-1`
      blocks.push(
        ordered ? (
          <ol key={`b-${key}`} className={listClass}>
            {items.map((it, idx) => <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>)}
          </ol>
        ) : (
          <ul key={`b-${key}`} className={listClass}>
            {items.map((it, idx) => <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>)}
          </ul>
        ),
      )
      key++
      continue
    }

    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !HEADING_LINE_RE.test(lines[i]) &&
      !LIST_LINE_RE.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push(
      <p key={`b-${key}`} className="text-[14px] text-espresso tracking-body leading-[1.6] my-2">
        {renderInline(paraLines.join(" "), `p-${key++}`)}
      </p>,
    )
  }

  return <>{blocks}</>
}
