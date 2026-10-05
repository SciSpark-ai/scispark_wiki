# Local engines and interface recovery — October 4, 2026

Branch: `codex/local-profiles-vaults`, following `912b3c0`.
Scope: the six October 2 interface-review findings and verification of the
installed local-engine paths. The approved cream/espresso interface, typography,
research interactions, and explicit review-usage recovery remain intact.

## Installed engines: separate live evidence from fixtures

| Engine | Installed version | Native status | Real completion evidence |
| --- | --- | --- | --- |
| Codex | 0.159.0 | Ready | Four successful synthetic calls: structured response, feed strategy, feed assessment, review planning |
| Claude Code | 2.1.282 | Ready after native sign-in | Four successful synthetic calls through SciSpark: structured response, feed strategy, feed assessment, review planning |

Codex's structured-response check used GPT-6-Astra with a 60-second timeout,
low reasoning effort and a requested 512-token output limit. It returned the
validated result and reported subscription usage. The feed check used
GPT-6-Astra for strategy and GPT-6-Sol for assessment with fictional papers and
an in-memory profile. Both stages succeeded; the resulting cache contained one
ranked paper and subscription billing metadata. The review check used
GPT-6-Astra through `reviewComplete` and the real reservation ledger with an
in-memory vault. Planning succeeded; repeating the same stage reused the settled
result, with one engine call, no uncertain usage and zero API-dollar spending.
Local CLI output limits are approximate.

These checks establish real transport, parsing, feed orchestration and review
planning/reuse. They do not establish completion or scientific quality of a
whole live literature review. No new Codex completion failure was reproduced.
The user's existing failed review was not retried or acknowledged.

After native Claude sign-in, the first SciSpark request revealed a real
integration failure: Zod emitted a Draft 2020-12 JSON Schema, which Claude's
`--json-schema` validator rejected before inference. A direct synthetic CLI
completion succeeded, isolating the failure to SciSpark's schema dialect.

The local Claude provider now requests Draft 7 generation from Zod, and the
skill/review wrappers preserve that capability. Codex and API providers retain
their existing schema dialect. Generating Draft 7, rather than deleting the
`$schema` field, preserves tuple and optional-field constraints. Responses still
pass the original Zod validation; subscription failures are not automatically
retried. The error classifier recognizes the CLI's schema rejection without
exposing raw diagnostics.

Claude then passed the structured-response and review-planning/reuse gates with
Sonnet, and feed strategy/assessment with Sonnet/Haiku. The feed cached one
synthetic ranked paper with subscription billing; the review ledger recorded
one settled call, no uncertain usage and zero API-dollar spending. These were
four real SciSpark calls, in addition to the direct diagnostic completion.
Both engines also passed deterministic browser flows with CLI fixtures; fixture
results are reported separately from real model responses. No API fallback or
credential copying was used. The user's saved engine/model choices and paused
review's three-call record were left untouched.

The opt-in tests now support either installed engine:

```sh
SCISPARK_ENGINE_SMOKE=codex SCISPARK_ENGINE_MODEL=gpt-6-astra npx vitest run src/lib/engines/__tests__/installed-completion.test.ts
SCISPARK_ENGINE_FEED_SMOKE=codex SCISPARK_ENGINE_STRONG_MODEL=gpt-6-astra SCISPARK_ENGINE_FAST_MODEL=gpt-6-sol npx vitest run src/lib/engines/__tests__/installed-feed.test.ts
SCISPARK_ENGINE_REVIEW_SMOKE=codex SCISPARK_ENGINE_MODEL=gpt-6-astra npx vitest run src/lib/engines/__tests__/installed-review.test.ts
```

These explicit gates consume subscription capacity. For Claude, use engine
`claude-code` and account-supported models such as `sonnet`/`haiku` after login.
Ordinary tests leave these gates skipped.

## Interface findings addressed

1. **Mobile navigation:** one dedicated close control; no overlapping theme or
   desktop-collapse control. Destinations, recent chats, the current route and
   backdrop clicks dismiss the drawer. Desktop resizing releases modal focus
   and background inertness. Focus enters the visible drawer immediately.
2. **Settings focus:** Tab/Shift+Tab stay inside the dialog; the background is
   inert; Escape restores a visible profile/menu control. Opening Settings from
   the mobile profile menu transfers focus correctly.
3. **Review copy:** a neutral introduction works across review states. Existing
   saved brief messages render the neutral copy without rewriting transcripts.
   The actual saved review was checked in the updated preview: its three-call
   record and explicit usage-recovery action remain visible.
4. **Model selection:** Codex advertises only discovered model choices; Check
   connection bypasses its catalog cache after a CLI update. Loading, discovery
   failure, signed-out state and unavailable saved IDs have distinct handling.
   Claude retains custom model IDs. No unsupported Codex ID can be saved.
5. **Feed chips:** remove broken parenthetical fragments and explanatory notes,
   reject long prose/instructions and fall back to paper fields. Full original
   recommendation evidence remains in Why this paper. Both old cached tags and
   newly generated tags use the same browser-safe helper.
6. **Similar chat titles:** recent shortcuts under History show creation dates
   and times, with the full first question available as the link title. Two
   similarly titled real conversations were distinguishable in the preview.

The real saved conversation also restored after Wiki → Sparky navigation.

## Verification

- TypeScript: `npx tsc --noEmit` passed.
- ESLint: zero errors; one unchanged `ConnectAiCard.tsx:178` exhaustive-deps warning.
- Vitest: **2,660 passed / 19 gated skips**, 268 passing test files after the
  Claude schema fix (the earlier interface gate passed 2,657 tests).
- Production build: `npm run build` passed using `.next-claude-schema-fix` and
  scheduling off; the earlier interface gate used `.next-oct4-final`.
- Seven affected production-browser scenarios passed: design recovery; History/
  Sparky desktop and mobile; feed navigation/reload; model selection for each
  fixture engine; background review/recovery for each fixture engine.
- After the Claude schema fix, all five affected production-browser scenarios
  passed again on the new build: connection/model persistence for both engines,
  background review/navigation/reload/recovery for both engines, and server feed
  completion plus preservation of the previous cache after a failed refresh.
  These use disposable vaults, deterministic sources and subprocess fixtures.

The final seven-scenario run passed six scenarios; the design test initially
asserted before the responsive media-query event was handled. Its assertion now
waits for background inertness to clear, and its production rerun passed.
Earlier iterations also caught an invalid empty strategy in the new synthetic
fixture, drawer visibility/focus timing, and backdrop containment. These were
corrected before the final verification. A sandbox-denied Turbopack worker
required an approved build in a clean output directory. Generated temporary
TypeScript include entries were removed from the source diff.

Screenshots were saved locally for the desktop feed/history, Settings focus,
mobile drawer, populated mobile History, fixture review recovery, and the
existing review's corrected introduction. They contain test or local vault
content and are not published in this repository. The local preview was
restarted from the tested production build on loopback with scheduling off.

The Claude dialect regression failed before implementation. A faithful CLI
fixture now rejects Draft 2020-12 for Claude, catching missing dialect
propagation through real skill/review wrappers. All 48 focused tests passed
after implementation, including original-contract validation and redacted
schema-error handling. Native sign-in and the corresponding live gates are
complete. Whole live literature-review completion and scientific-quality
acceptance remain outside these bounded transport/orchestration checks.
