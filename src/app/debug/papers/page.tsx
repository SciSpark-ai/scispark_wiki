"use client"

import { useState } from "react"
import type { PaperRecord, SourceId } from "@/lib/papers/types"

const SOURCES: SourceId[] = ["arxiv", "openalex", "s2", "pubmed"]

const monoBox: React.CSSProperties = {
  fontFamily: "monospace",
  border: "1px solid #999",
  borderRadius: 4,
  padding: 12,
  marginTop: 8,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background: "#f6f6f6",
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  borderRadius: 6,
  padding: 16,
  marginBottom: 24,
}

const inputStyle: React.CSSProperties = {
  fontFamily: "monospace",
  padding: "4px 8px",
  border: "1px solid #999",
  borderRadius: 4,
}

function idBadges(ids: PaperRecord["ids"]): string {
  const parts: string[] = []
  if (ids.doi) parts.push(`doi:${ids.doi}`)
  if (ids.arxiv) parts.push(`arxiv:${ids.arxiv}`)
  if (ids.openalex) parts.push(`openalex:${ids.openalex}`)
  if (ids.s2) parts.push(`s2:${ids.s2}`)
  if (ids.pmid) parts.push(`pmid:${ids.pmid}`)
  return parts.join(" · ")
}

function PaperCard({ p }: { p: PaperRecord }) {
  return (
    <div style={{ ...monoBox, background: "#fff" }}>
      <div style={{ fontWeight: "bold" }}>{p.title}</div>
      <div style={{ fontSize: 12, color: "#555" }}>{idBadges(p.ids)}</div>
      <div style={{ fontSize: 12 }}>
        {p.year ?? "?"} · {p.venue ?? "(no venue)"} · citations: {p.citationCount ?? "?"}
      </div>
      {p.abstract && <div style={{ marginTop: 4 }}>{p.abstract.slice(0, 200)}{p.abstract.length > 200 ? "…" : ""}</div>}
      <div style={{ marginTop: 4, fontSize: 12 }}>
        {p.oaUrl && (
          <a href={p.oaUrl} target="_blank" rel="noreferrer">
            oaUrl
          </a>
        )}
        {p.oaUrl && p.pdfUrl && " · "}
        {p.pdfUrl && (
          <a href={p.pdfUrl} target="_blank" rel="noreferrer">
            pdfUrl
          </a>
        )}
      </div>
    </div>
  )
}

function SearchSection() {
  const [source, setSource] = useState<SourceId>("arxiv")
  const [q, setQ] = useState("transformer")
  const [limit, setLimit] = useState("5")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [papers, setPapers] = useState<PaperRecord[] | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setPapers(null)
    setRawError(null)
    setStatus(null)
    try {
      const url = `/api/search/${source}?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`
      const res = await fetch(url)
      setStatus(res.status)
      const body = await res.json()
      if (res.ok && Array.isArray(body?.papers)) {
        setPapers(body.papers as PaperRecord[])
      } else {
        setRawError(JSON.stringify(body, null, 2))
      }
    } catch (err) {
      setRawError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={sectionStyle}>
      <h2>Search</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          style={inputStyle}
          value={source}
          onChange={(e) => setSource(e.target.value as SourceId)}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="query" />
        <input
          style={{ ...inputStyle, width: 64 }}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="limit"
        />
        <button onClick={run} disabled={loading}>
          {loading ? "searching…" : "Search"}
        </button>
        {status !== null && <span>status: {status}</span>}
      </div>
      {papers && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {papers.length === 0 && <div style={monoBox}>0 results</div>}
          {papers.map((p, i) => (
            <PaperCard key={i} p={p} />
          ))}
        </div>
      )}
      {rawError && <div style={monoBox}>{rawError}</div>}
    </section>
  )
}

function ResolveSection() {
  const [doi, setDoi] = useState("10.1038/nature12373")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setResult(null)
    setStatus(null)
    try {
      const res = await fetch(`/api/resolve?doi=${encodeURIComponent(doi)}`)
      setStatus(res.status)
      const body = await res.json()
      setResult(JSON.stringify(body, null, 2))
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={sectionStyle}>
      <h2>Resolve</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, width: 320 }} value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="doi" />
        <button onClick={run} disabled={loading}>
          {loading ? "resolving…" : "Resolve"}
        </button>
        {status !== null && <span>status: {status}</span>}
      </div>
      {result && <div style={monoBox}>{result}</div>}
    </section>
  )
}

function RelaySection() {
  const [url, setUrl] = useState("https://arxiv.org/abs/2406.09246")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [contentType, setContentType] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setStatus(null)
    setContentType(null)
    setSummary(null)
    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`)
      setStatus(res.status)
      const ct = res.headers.get("content-type") ?? "(none)"
      setContentType(ct)
      if (ct.toLowerCase().startsWith("application/pdf")) {
        const buf = await res.arrayBuffer()
        setSummary(`PDF ${buf.byteLength} bytes`)
      } else {
        const text = await res.text()
        setSummary(text.slice(0, 500))
      }
    } catch (err) {
      setSummary(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section style={sectionStyle}>
      <h2>Fetch relay</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, width: 420 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="url" />
        <button onClick={run} disabled={loading}>
          {loading ? "fetching…" : "Fetch"}
        </button>
        {status !== null && <span>status: {status}</span>}
        {contentType !== null && <span>content-type: {contentType}</span>}
      </div>
      {summary && <div style={monoBox}>{summary}</div>}
    </section>
  )
}

export default function PapersDebugPage() {
  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Papers proxy debug</h1>
      <p>Manual verification gate for /api/search/[source], /api/resolve, /api/fetch.</p>
      <SearchSection />
      <ResolveSection />
      <RelaySection />
    </div>
  )
}
