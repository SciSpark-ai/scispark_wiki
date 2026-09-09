# Sparky proactive-message regression

## Scope and cause

The app-open trigger previously used cached-feed presence as a reason to speak
and always linked to Home. Frequency bookkeeping lived in a volatile Zustand
store, so reloads/new tabs reset it. The global mascot could retain an old
message after navigation, and dismissals were logged but not used to suppress
the same event on the next visit.

## Changed behavior

- No app-open greeting or generic Home invitation.
- Candidates require a concrete new review, recently ingested paper with a
  live Wiki destination, or recent concept-linked paper cluster without an idea.
- Server-owned `.scispark/companion-delivery.json` records event identities
  before AI generation. Claims are serialized across tabs using one vault's
  server singleton and atomically persisted across reloads/server restarts.
- Default maximum: two proactive deliveries per rolling 24 hours, at least
  30 minutes apart. Low: one and 60 minutes. High: four and 15 minutes. Off: none.
- A viewed destination consumes its current events without using the budget.
  Dismissed, failed, or abandoned claims stay consumed; corrupt/unwritable
  ledgers fail quiet. Reviews/clusters older than seven days are ineligible;
  post-ingest acknowledgement has a two-minute window. Ledger retention is
  eight days, beyond the event eligibility window.
- One AppShell hook owns checks. Navigation, Settings, input focus, and hidden
  tabs abort/invalidate UI streams and clear bubbles. Messages expire after
  60 seconds. Onboarding and Chat do not initiate proactive checks.
- Thumbs-down questions remain a separate, user-initiated queue. Route cleanup
  does not discard these questions. Feedback persistence and History are unchanged.

## Validation

- Seven new failing regressions reproduced the initial behavior before changes.
- Full Vitest: 2,396 passed, 15 skipped (paid/live gates remain skipped).
- TypeScript and production Webpack build passed.
- Full ESLint: no errors; the existing ConnectAiCard dependency warning remains.
- Production Playwright: 24 passed, with a disposable vault and local AI fixture.
  The new flow covers no app-open prompt, a review-specific action, dismissal,
  reload, a second tab, simultaneous API claims, already-visited inbox, and expiry.
- Separate hook tests cover late response cancellation during navigation,
  Settings and typing, and preserving user-initiated feedback during cleanup.
- Existing recommendation/feedback/History and Search settings flows passed.
- Desktop (1440×900) and phone (390×844) captures inspected; no horizontal overflow.

No paid model or external literature requests were made. Production server
restart details and the final artifact identity are recorded in project_memory.md.
This does not claim a live-provider evaluation of generated wording. The runtime
still uses the user's configured fast model, with an event-specific template
fallback. It never executes a suggested skill automatically.
