# M3: Proxy Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The stateless server surface from `docs/design/03-backend.md`: normalized paper search across arXiv/OpenAlex/Semantic Scholar/PubMed, DOI→open-access resolution via Unpaywall, and a guarded CORS relay for public full texts — with shared caching, rate limiting, and the identity-blind privacy stance.

**Architecture:** Pure-TS adapter library at `src/lib/papers/` (one adapter per source, injectable fetch, unified `PaperRecord` out) + tiny server utilities at `src/lib/server/` (TTL cache, token buckets) + thin Next.js route handlers under `src/app/api/`. Adapters are fixture-tested; route handlers export a testable core function and stay ~20 lines. Branches off `main` (M1) — no M2 dependency.

**Tech Stack:** Next.js 16 route handlers (Node runtime), TypeScript 5, Vitest, `fast-xml-parser` (arXiv Atom + PubMed efetch XML).

## Global Constraints

- **Privacy (design 03):** no logging of query strings or fetched URLs anywhere in server code (no `console.log(q)`); no cookies; no user identifiers. Cache keys may contain queries in memory — that's fine; they must never be persisted or logged.
- **Unified schema** (design 03, verbatim contract): `PaperRecord` as defined in Task 1. Adapters must fill what their source provides and leave the rest undefined — never fabricate. `citations`/`references` id-lists stay unfilled in M3 (M8 fetches them when the viz needs them); `citationCount` is filled where available.
- **API-drift guard:** before implementing each adapter, verify the endpoint + response shape against the source's live docs (WebFetch/context7) AND capture one real sample response as a JSON/XML fixture under `src/lib/papers/__tests__/fixtures/`. Tests run against fixtures, never the network.
- Server-held keys/etiquette via env vars only: `OPENALEX_MAILTO`, `UNPAYWALL_EMAIL` (required for those APIs' polite pools), `S2_API_KEY`, `NCBI_API_KEY` (optional, better rate limits). Document all in `.env.example`; never expose to the client bundle (no `NEXT_PUBLIC_`).
- `src/lib/papers/**` and `src/lib/server/**` are framework-free (no React/Next imports); route handlers in `src/app/api/**` are the only Next-aware layer.
- Route handlers set `Cache-Control: public, s-maxage=<ttl>, stale-while-revalidate` on cacheable success responses (CDN layer) in addition to the in-memory cache.
- Commit per task; `npm test` stays green (123 from M1/M2-on-main baseline: main has 40 — expect 40 + new; the M2 branch is not merged).

---

### Task 1: Unified paper schema + merge helpers

**Files:** Create `src/lib/papers/types.ts`; test `src/lib/papers/__tests__/types.test.ts`

**Interfaces — Produces (every adapter and route imports these):**

```ts
export type SourceId = "arxiv" | "openalex" | "s2" | "pubmed"

export interface PaperIds {
  doi?: string        // lowercase, no https://doi.org/ prefix
  arxiv?: string      // e.g. "2406.01234" (no version suffix)
  openalex?: string   // e.g. "W2741809807"
  s2?: string         // Semantic Scholar paperId
  pmid?: string
}

export interface PaperAuthor { name: string; openalexId?: string }

export interface PaperRecord {
  ids: PaperIds
  title: string
  abstract?: string
  authors: PaperAuthor[]
  year?: number
  date?: string          // YYYY-MM-DD when known
  venue?: string
  citationCount?: number
  oaUrl?: string         // best open-access landing/HTML url
  pdfUrl?: string
  htmlUrl?: string
  fields: string[]       // topical field labels, source vocabulary
  source: SourceId       // which adapter produced this record
}

export function normalizeDoi(raw: string | null | undefined): string | undefined
// strips https://doi.org/ or doi: prefixes, lowercases, trims; undefined for empty

export function paperKey(p: PaperRecord): string
// stable dedupe key: doi > arxiv > pmid > s2 > openalex > lowercased title

export function mergeRecords(a: PaperRecord, b: PaperRecord): PaperRecord
// same paper from two sources: union ids; prefer defined-over-undefined per field;
// longer abstract wins; citationCount = max; fields deduped union
```

Steps: failing tests for normalizeDoi (prefix forms, case, empty), paperKey precedence, mergeRecords (id union, longer abstract, max citations) → implement → pass → commit `feat(papers): unified paper schema and merge helpers`.

---

### Task 2: Server utilities — TTL cache + token buckets

**Files:** Create `src/lib/server/ttl-cache.ts`, `src/lib/server/rate-limit.ts`; tests under `src/lib/server/__tests__/`

**Produces:**
- `class TtlCache<V> { constructor(opts: {ttlMs: number; maxEntries: number; now?: () => number}); get(k: string): V | undefined; set(k: string, v: V): void }` — expiry by ttl, LRU eviction at maxEntries, injectable clock.
- `class TokenBucket { constructor(opts: {capacity: number; refillPerSec: number; now?: () => number}); take(key: string, n?: number): boolean }` — per-key buckets (key = upstream API name, or client IP for /api/fetch); `false` = rate-limited. Bucket map bounded (maxKeys 10_000, LRU-evict oldest) so hostile IP churn can't grow memory unboundedly.

Steps: tests (ttl expiry with fake clock; LRU eviction order; bucket refill over time; per-key isolation; maxKeys eviction) → implement (~60 lines each) → commit `feat(server): ttl cache and token-bucket rate limiter`.

---

### Task 3: OpenAlex adapter

**Files:** Create `src/lib/papers/openalex.ts`; fixture + test.

**Contract:** `searchOpenAlex(q: {query: string; limit?: number; fromDate?: string}, deps: {fetchFn?: typeof fetch; mailto?: string}): Promise<PaperRecord[]>`
- GET `https://api.openalex.org/works?search=<query>&per-page=<limit≤50>&mailto=<mailto>` (+`&filter=from_publication_date:<fromDate>` when set). Verify param names against live docs (drift guard).
- **Abstract reconstruction:** OpenAlex returns `abstract_inverted_index` (word → positions[]) — reconstruct plain text by placing words at their positions and joining. Handle missing index (undefined abstract).
- Map: DOI (normalizeDoi from `ids.doi`), openalexId from `id` URL tail, title (`display_name`), authors from `authorships[].author.{display_name, id-tail}`, year/date, venue from `primary_location.source.display_name`, `cited_by_count`, oa urls from `open_access.oa_url` + `primary_location.pdf_url`, fields from `concepts[].display_name` (top ~5 by score) — verify current field names (concepts vs topics) against docs.
- Non-200 → throw `PaperSourceError` (define in types.ts task-1 file or here; exported class with `status`).

Steps: drift-verify docs; capture one real response as fixture (a `works?search=` call — trim to ≤3 results, keep structure intact); failing tests (mapping incl. reconstructed abstract; missing-abstract case; non-200 throw) → implement → commit `feat(papers): OpenAlex adapter with abstract reconstruction`.

---

### Task 4: arXiv adapter

**Files:** Create `src/lib/papers/arxiv.ts`; XML fixture + test. Install `fast-xml-parser`.

**Contract:** `searchArxiv(q, deps: {fetchFn?}): Promise<PaperRecord[]>`
- GET `http://export.arxiv.org/api/query?search_query=all:<query>&max_results=<limit>&sortBy=submittedDate&sortOrder=descending` (https if supported — verify). Response is Atom XML: parse with fast-xml-parser (arrays forced for `entry`, `author`, `link`, `category`).
- Map: arxiv id from `<id>` URL (strip version, e.g. `v2`), title/summary (collapse whitespace), authors, date from `<published>`, `pdfUrl` from link rel="related" type="application/pdf" (or title="pdf"), `htmlUrl` = abs page, fields from `<category term>`, DOI from `<arxiv:doi>` when present. `venue` = journal ref if present else undefined; citationCount undefined (arXiv doesn't provide).

Steps: drift-verify; fixture (real Atom response, 2–3 entries); failing tests (mapping, version-stripping, single-entry non-array edge — parser must force arrays); implement; commit `feat(papers): arXiv adapter (Atom)`.

---

### Task 5: Semantic Scholar adapter

**Files:** Create `src/lib/papers/s2.ts`; fixture + test.

**Contract:** `searchS2(q, deps: {fetchFn?; apiKey?}): Promise<PaperRecord[]>`
- GET `https://api.semanticscholar.org/graph/v1/paper/search?query=<q>&limit=<n>&fields=title,abstract,authors,year,publicationDate,venue,citationCount,externalIds,openAccessPdf` — verify field list against docs. Header `x-api-key` when apiKey set.
- Map externalIds → doi/arxiv/pmid; s2 id from `paperId`; pdfUrl from `openAccessPdf.url`; fields from `fieldsOfStudy` if requested/available.
- 429 → `PaperSourceError` with status (route layer converts to Retry-After response).

Steps: drift-verify; fixture; failing tests; implement; commit `feat(papers): Semantic Scholar adapter`.

---

### Task 6: PubMed adapter

**Files:** Create `src/lib/papers/pubmed.ts`; two fixtures (esearch JSON, efetch XML) + test.

**Contract:** `searchPubmed(q, deps: {fetchFn?; apiKey?}): Promise<PaperRecord[]>`
- Two-step E-utilities flow: (1) `esearch.fcgi?db=pubmed&term=<query>&retmax=<limit>&retmode=json&sort=date` → pmids; empty → []. (2) `efetch.fcgi?db=pubmed&id=<pmids>&retmode=xml` → parse PubmedArticle XML for title, abstract (join AbstractText sections; handle attribute-labeled sections), authors (LastName + ForeName), journal title as venue, year/date from PubDate/ArticleDate, DOI from ArticleIdList (IdType="doi"). `api_key` param appended when set.
- fields: MeSH major headings (top 5) when present.

Steps: drift-verify; fixtures from a real 2-pmid query; failing tests (multi-section abstracts, missing DOI, empty result) → implement → commit `feat(papers): PubMed adapter (esearch+efetch)`.

---

### Task 7: Unpaywall adapter + /api/resolve route

**Files:** Create `src/lib/papers/unpaywall.ts`, `src/app/api/resolve/route.ts`; fixture + tests.

**Contract:**
- `resolveOa(doi: string, deps: {fetchFn?; email: string}): Promise<{oaUrl?: string; pdfUrl?: string; isOa: boolean}>` — GET `https://api.unpaywall.org/v2/<doi>?email=<email>`; map `best_oa_location.{url_for_landing_page,url_for_pdf}`; 404 → `{isOa: false}` (unknown DOI is a normal answer, not an error).
- Route `GET /api/resolve?doi=<doi>`: validate doi shape (`10.` prefix after normalize; else 400); TtlCache (ttl 24h, maxEntries 5000); token bucket per-API ("unpaywall", capacity 10, refill 5/s); on bucket exhaustion → 429 with Retry-After: 1; success → JSON + `Cache-Control: public, s-maxage=86400`. Export core `handleResolve(doi, deps)` for tests; `route.ts` = param extraction + env wiring (`UNPAYWALL_EMAIL`; missing env → 503 with clear body).

Steps: drift-verify; fixture; failing tests (adapter mapping + 404 case; core handler: bad doi 400, cache hit short-circuits fetch — count fetch calls, 429 on bucket empty) → implement → commit `feat(papers,api): Unpaywall resolve + /api/resolve`.

---

### Task 8: /api/search/[source] route

**Files:** Create `src/lib/papers/search-core.ts`, `src/app/api/search/[source]/route.ts`; tests for the core.

**Contract:**
- Core `handleSearch(source: string, params: {q?: string; limit?: string; from?: string}, deps: {fetchFn?; env: Record<string, string | undefined>; cache?: TtlCache<PaperRecord[]>; buckets?: TokenBucket}): Promise<{status: number; body: unknown; headers?: Record<string,string>}>`
  - source ∉ {arxiv, openalex, s2, pubmed} → 404; missing/blank q → 400; limit clamped 1–50 (default 20).
  - Cache key `${source}:${q}:${limit}:${from ?? ""}` (module-level TtlCache, ttl 10 min, maxEntries 2000 — injectable for tests).
  - Per-source TokenBucket (capacity/refill: arxiv 3 & 1/s; openalex 10 & 5/s; s2 5 & 1/s; pubmed 5 & 3/s) — exhausted → 429 Retry-After 2. Buckets protect UPSTREAMS (shared per source, not per client).
  - Dispatch to the adapter with env-wired etiquette (mailto/apiKeys); `PaperSourceError` status 429 from upstream → 429; other adapter errors → 502 with `{error}` (no query echoed — privacy).
  - Success body `{papers: PaperRecord[]}` + s-maxage=600.
- `route.ts`: `export async function GET(req, {params})` — extract, call core with `process.env`, return `NextResponse.json`.

Steps: failing core tests with stub adapters (inject via a `deps.adapters` override map — add that to the core signature; defaults to real adapters): unknown source, missing q, clamp, cache-hit (adapter called once), bucket 429, upstream 502 without query echo → implement → typecheck against a running `npm run dev` curl smoke (`/api/search/openalex?q=test` returns 200 JSON with real env or 502-shaped error without) → commit `feat(api): normalized /api/search/{source} with caching and rate limits`.

---

### Task 9: /api/fetch relay

**Files:** Create `src/lib/server/fetch-relay.ts`, `src/app/api/fetch/route.ts`; tests for core.

**Contract — the security-sensitive route; every rule below is load-bearing:**
- Core `handleFetchRelay(rawUrl: string | null, clientKey: string, deps: {fetchFn?; ipBuckets?: TokenBucket}): Promise<Response>`
- Allowlist (exported const `RELAY_ALLOWED_HOSTS`): `arxiv.org`, `*.arxiv.org`, `europepmc.org`, `*.europepmc.org`, `ncbi.nlm.nih.gov`, `*.ncbi.nlm.nih.gov`, `biorxiv.org`, `*.biorxiv.org`, `medrxiv.org`, `*.medrxiv.org`, `openalex.org` — suffix-match on hostname LABELS (parse with `new URL`; `endsWith(".arxiv.org") || host === "arxiv.org"` — never substring includes, which `evil-arxiv.org` defeats).
- Reject (400/403, generic bodies, no URL echoed): unparseable URL; non-https (allow http only for export.arxiv.org); host not allowlisted; URL with userinfo (`user@host`); redirects followed manually up to 3 hops with EACH hop re-checked against the allowlist (use `fetchFn(url, {redirect: "manual"})`).
- IP rate limit: TokenBucket keyed by clientKey (capacity 20, refill 0.5/s) → 429.
- Response constraints: only content-types `application/pdf`, `text/html`, `application/xml`, `text/xml`, `text/plain` (prefix match before `;`) → else 415. Stream the body through; enforce 50 MB cap by wrapping the stream (count bytes, abort + truncate error when exceeded). Pass through Content-Type; set `Cache-Control: public, s-maxage=3600`; strip upstream Set-Cookie.
- `route.ts`: GET `?url=`, clientKey from `x-forwarded-for` first IP (fallback "local"), call core.

Steps: failing core tests with stub fetch (allowlisted ok; `evil-arxiv.org` host 403; substring-attack `arxiv.org.evil.com` 403; userinfo 403; http-non-arxiv 403; redirect to non-allowlisted host 403; content-type text/javascript 415; >cap → aborted; bucket 429; Set-Cookie stripped) → implement → commit `feat(api): guarded /api/fetch relay (allowlist, size cap, streaming)`.

---

### Task 10: /debug/papers page + env docs

**Files:** Create `src/app/debug/papers/page.tsx`, `.env.example`; modify `README.md` (env section only, if a better home doesn't exist).

- `.env.example`: the four env vars with one-line comments (OPENALEX_MAILTO, UNPAYWALL_EMAIL, S2_API_KEY optional, NCBI_API_KEY optional).
- `/debug/papers` ("use client", monospace style like the other debug pages): source selector + query input → calls `/api/search/<source>` and renders the unified records (title, ids, year, venue, citations, abstract first 200 chars, oa/pdf links); a DOI input → `/api/resolve`; a URL input → `/api/fetch` (renders status + content-type + first bytes for text, or "PDF <n> bytes"). This page is M3's manual verification gate — it exercises all three routes against the real APIs.
- Verification: `npm test`, `npx tsc --noEmit`, eslint on new files; dev server: `/api/search/arxiv?q=transformer` (no key needed) returns real results; `/api/search/openalex?q=transformer` with OPENALEX_MAILTO set; `/debug/papers` serves 200. Report which sources were live-verified vs env-blocked.
- Commit `feat(api): /debug/papers verification page and env docs`.

---

## Self-Review Notes

- **Spec coverage (design 03 M3 slice):** `/api/search/{4 sources}` unified schema ✓ (T1, 3–6, 8), `/api/resolve` ✓ (T7), `/api/fetch` with allowlist/size-cap/IP-limit/no-logging ✓ (T9), shared caching ✓ (T2 + s-maxage), server-held keys ✓ (env), identity-blind ✓ (constraints + no-echo tests). Deferred per roadmap: `/api/trending` + cron + `/api/register` (M10); citation/reference id-lists (M8); Redis/durable cache (in-memory + CDN suffices for v1 — serverless instance reuse via Fluid Compute makes in-memory caching worthwhile, note in code).
- **Type consistency:** `PaperRecord`/`PaperSourceError` from T1 used by all adapters; `TtlCache`/`TokenBucket` from T2 in T7–9; core-handler pattern uniform (T7/8/9).
- **Risks:** upstream API drift (mitigated per-task by mandatory doc verification + real-sample fixtures); in-memory cache/buckets reset per serverless cold start (acceptable — CDN s-maxage carries the load; documented); PubMed XML variance (fixtures must include a multi-section abstract).
