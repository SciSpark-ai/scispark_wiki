# Selected passages in Sparky — 2026-10-04

The paper digest and HTML/PDF reader previously mounted an independent AskPanel.
It called the reading-companion endpoint and kept its result in page state. It did
not share Sparky's server-resolved full text, saved conversation, or reconnect path.
The screenshot alone does not establish why that particular provider call was slow.

Selection actions now offer **Ask Sparky** and open the global companion. The
selection starts one explanation in the paper conversation. Follow-up questions
use the same transcript. If a response is already running, a second selection
stays in the composer as an explicit draft rather than silently queuing a call.

- Selected text and bounded surrounding text are validated, fenced as untrusted
  context, and stored with the user turn. Full-text evidence comes from the server.
- QuickChat remembers its conversation pointer per paper within the profile's
  browser state. The actual transcript and pending job stay in the vault.
- Navigation/reload reconnects with status reads, without repeating the model call.
  Provider/transport/interruption errors replace the pending indicator.
- History renders the quoted passage. Explicit wiki saves retain quote, question,
  paper and chat provenance, citations, related source page, and atomic changesets.
- Highlighting, Capture idea, and Save to note remain available. The older reading
  endpoint and standalone component remain for compatibility, but neither paper
  nor reader selection actions use them.

## Validation

- New backend regressions failed before implementation, then passed.
- `npx tsc --noEmit`: passed.
- `npm run lint`: 0 errors; 1 existing ConnectAiCard exhaustive-deps warning.
- `npx vitest run`: 2,701 passed / 19 skipped (273 passing files / 7 skipped).
  Seven old standalone AskableSurface expectations were replaced by a handoff
  regression, seven QuickChat tests, two paper-context tests, and a prompt-fence
  test: net +4 relative to the background-action fix's 2,697 passing baseline.
- Production build: `.next-selection-sparky`, Next.js 16.3.2, passed. The restricted
  compiler stalled; rerunning with local process permissions completed normally.
- Eight production Playwright tests passed using disposable vaults and a local
  mock model: selected-passage navigation/reload/save/History, paper context,
  two streaming tests, Trending-to-paper, ingestion, digest, and chat recovery.
- Desktop (1440 px) and mobile (390 px) screenshots were inspected; the shared
  panel and composer fit the viewport without horizontal overflow.
- Localhost:3000 was restarted with the verified build after confirming no running
  skill jobs; existing reviews were paused/awaiting approval. The real paper was
  reopened and Sparky showed its paper title. No live AI call or user-vault
  content mutation was performed during this fix.

Screenshots are under the current task's `selection-sparky` visualization folder:
`selected-sparky-1440.png`, `selected-sparky-390.png` (mock-provider E2E), and
`local-paper-sparky.png` (the actual local paper, no submitted question).

The existing saved paper also shows an unavailable reader button despite its
full-text digest and repeats digest content in the wiki body; those pre-existing
paper-page issues are separate from this selection/conversation change.
