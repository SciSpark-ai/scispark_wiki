# Paper context in floating Sparky

The floating chat on `/paper/[key]` previously sent a generic knowledge-base
question. An unsaved paper and its digest never reached the answer model.

The launcher now passes the current paper slug and displays its title. The server
resolves metadata from the active vault, then acquires verified full text before
answering. It prefers downloaded HTML/PDF, then bounded public sources. Abstract
and cached digest are fallback context only; the digest is omitted when full text
is available. See `2026-10-04-paper-full-text.md` for the follow-up fix. The validated, bounded evidence snapshot stays with the
conversation, so History follow-ups still work after discovery caches expire.
Switching paper routes starts a separate floating conversation; closing the panel
on the same page still preserves the conversation and any running response.

The prompt interprets unspecified questions as about this paper. It distinguishes
source text from AI-generated digest text, reports actual source coverage,
and asks for clarification when the referent or evidence is insufficient. Explicit
requests for general background are labeled separately. Read-sources-only excludes
the digest and outside knowledge. Explicit search/review modes remain available.
Existing conversations without paper context are not retroactively assigned one.

Paper citations render with answers. Explicit Save to knowledge base remains
available and preserves server-owned cited-paper references plus the chat source
in an ordinary undoable changeset. Opening the panel alone makes no model call.

## Initial paper-context verification (before the full-text follow-up)

- Test-first: all eight initial paper-context regressions failed before the
  implementation. Added save/provenance and citation-bearing Save-button coverage.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; one existing ConnectAiCard exhaustive-deps warning.
- `npx vitest run`: 2,670 passed / 19 skipped (269 files passed / 7 skipped).
- `SCISPARK_LIVE_GATE_DIST_DIR=.next-paper-chat npm run build`: passed.
- Production Playwright through the disposable-vault runner: three tests passed
  (`paper-chat-context`, `quick-chat`, `paper-digest-layout`). The new test sends
  the reported detector question, checks that the local fixture provider actually
  receives the abstract and digest, saves the answer with references, switches
  papers through client navigation, and continues via History after a reload.
- Desktop (1440 px) and mobile (390 px) context panels were visually inspected;
  the digest regression covers six widths and both themes.
- The local preview at port 3000 was updated and the real SGAD page was inspected:
  opening Sparky visibly identifies the paper and explains its default scope.

Browser responses use a deterministic local mock provider. No paid/live model call
was made, so these checks establish context delivery, persistence, UI behavior and
prompt rules, not live-model answer quality. Real research content was not modified.

Screenshots and logs are in
`/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/paper-chat-2026-10-04/`.
Screenshots contain synthetic test papers and mock replies.
