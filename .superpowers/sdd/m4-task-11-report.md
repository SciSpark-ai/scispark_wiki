# M4 Task 11 Report — Live end-to-end ingest gate

**Status: BLOCKED (environmental — network filter, not code/prompts)**

## What was built

`src/lib/skills/__tests__/live-ingest.test.ts` — the live end-to-end gate for M4:

- Env-gated on `LIVE_LLM_BASE_URL` / `LIVE_LLM_API_KEY` / `LIVE_LLM_MODEL`
  (same `describe.skipIf` pattern as `src/lib/llm/__tests__/live-openai-compat.test.ts`),
  plus an always-on wiring-guard test so the file is never an empty suite.
  300s timeout on the live test.
- Setup: `MemoryVaultStorage` + `createVault({ purpose: "Track research on large
  language models and NLP.", today })`; settings map both tiers ("fast"/"strong")
  to the live model via the `openai` provider id with `baseUrls.openai` override.
- Node relay shim: `acquireFullText` expects the M3 same-origin relay, so the test
  passes `apiBase: ""` and a `fetchFn` that rewrites `/api/fetch?url=<enc>` to a
  direct `fetch(decoded)` and answers `/api/resolve?doi=` with a 503 (the paper has
  no DOI anyway).
- Paper: hardcoded real arXiv paper `1706.03762` ("Attention Is All You Need",
  3 authors, 2017, NeurIPS, real short-form abstract). If the arXiv HTML mirror is
  unavailable at runtime the test proceeds on the abstract and adapts the
  `full_text` assertion — arXiv availability is not the gate's subject.
- Flow: `acquireFullText` → (html? `snapshotSource`) → `generateDigest` →
  `runSkill(ingestSkill, { storage, paper, digest, fullText, today })`.
- Assertions:
  1. run status `"ok"` AND `output.status "ok"` — a `"draft"` result (after the
     skill's internal one-shot retry) FAILS the gate and prints the draft errors +
     every draft file (path/type/title/body) for prompt iteration.
  2. Paper page at `wiki/papers/1706-03762.md` with `arxiv`/`authors` frontmatter,
     `full_text` matching the acquisition kind, `## Digest` section in the body.
  3. ≥1 author page; ≥1 non-paper/non-author knowledge page; every touched file's
     `{path, type}` (type read back from the composed frontmatter) passes
     `validateFilesAgainstRouting(loadRouting(storage))` with zero errors.
  4. `index.md` contains the paper slug; `log.md` has an ingest entry; review files
     parse via `listReviews` and count matches `output.reviews` with correct
     `changesetId`/kind enum.
  5. Cost: digest `costUsd` + ingest run `costUsd` < $1.00; console-logs the page
     tree and one generated knowledge page body for this report.
  6. `undoIngest(storage, changesetId)`: `wiki/**` + `index.md` snapshot-compared
     byte-identically to the pre-ingest snapshot taken right before `runSkill`.
     `index.md` is normalized through `writeIndex` before the pre-snapshot (undo
     rebuilds it via `writeIndex`, whose empty-bundle serialization differs from the
     scaffold stub). Excluded by design: `log.md` (gains the undo entry),
     `.scispark/**` (digest cache, run/usage records, changeset audit, archived
     reviews — written outside the changeset), `sources/**` (immutable snapshot).
     Also asserts the undo log entry exists and active reviews are empty after undo.

## Verification results

- `npx tsc --noEmit` — clean.
- `npm test` — 40 files, **501 passed, 4 skipped** (3 pre-existing live LLM tests +
  the new live-ingest test, all skipped without env), 0 failures. The new wiring
  guard runs and passes without env.
- Skip path verified: `npx vitest run src/lib/skills/__tests__/live-ingest.test.ts`
  without env → 1 passed, 1 skipped.

## Live run: BLOCKED by the local network's security filter

Command attempted (key via env only, never committed):

```
LIVE_LLM_BASE_URL=https://api.gmi-serving.com/v1 \
LIVE_LLM_MODEL='anthropic/claude-sonnet-5' \
LIVE_LLM_API_KEY=<GMI key> \
npx vitest run src/lib/skills/__tests__/live-ingest.test.ts
```

What happened:

- **Acquisition worked live**: `kind=html textChars=40626
  sourceUrl=https://arxiv.org/html/1706.03762` — the relay shim + arXiv HTML path is
  proven end-to-end.
- **Every HTTPS request to `api.gmi-serving.com` fails** with `fetch failed`
  (`SSL routines … wrong version number` / `packet length too long`), so the digest
  call (the first LLM call) throws before any prompt is exercised.

Diagnosis (deterministic, reproduced outside the test):

- `curl https://api.gmi-serving.com/v1/models` → SSL error "packet length too long"
  (server answered the TLS ClientHello with **plaintext**).
- `curl http://api.gmi-serving.com/v1/models` → `302 Found` to
  `https://www.safebrowse.io/warn.html?url=…` — **safebrowse.io is Xfinity xFi
  Advanced Security**, an inline network content filter on this machine's network.
- The interception is **SNI-keyed**: `openssl s_client -connect 104.18.12.99:443
  -servername api.gmi-serving.com` gets the plaintext block, while the same IP with
  `-servername cloudflare.com` completes a normal TLS handshake. DNS answers are
  identical from the local resolver (Comcast, 75.75.75.75) and 1.1.1.1, so it is not
  DNS poisoning — it's an inline transparent proxy keying on the TLS SNI.
- No alternate official GMI API hostname resolves (`api.gmicloud.ai`,
  `api.gmi.cloud`, `inference.gmicloud.ai` — NXDOMAIN).

I did not attempt to evade the filter (SNI spoofing / domain fronting / disabling
TLS verification are security-control bypasses and out of bounds).

**Zero prompt iterations were possible** — the failure is before the first LLM call.
No prompt edits were made to `src/lib/skills/ingest.ts`; all 501 unit tests remain
green and untouched.

## How to unblock

1. Allowlist `gmi-serving.com` in the Xfinity app (xFi → Advanced Security →
   allow the blocked site), or temporarily disable Advanced Security, or run from a
   different network (e.g. phone hotspot / VPN the user controls).
2. Re-run the exact command above. The test is written to pass-or-print: an `ok`
   run asserts everything; a `draft` run prints validation errors + full draft
   files, and a failing assertion prints the run logs/error — everything needed for
   the budgeted prompt-iteration loop (up to 4 live runs, ~$0.10–0.40 each,
   asserted < $1.00 total per run).

## Generated page tree + sample page

Not available — the LLM endpoint was unreachable, so no pages were generated. The
test console-logs the full `wiki/` tree, one generated knowledge-page body, and the
review list on a successful run; paste them here after the unblocked run.

## Costs

$0.00 spent (no LLM call ever completed; acquisition hit only arxiv.org).
