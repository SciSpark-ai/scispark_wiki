# Personal Semantic Scholar keys — September 6, 2026

## Scope

User approved an optional personal Semantic Scholar API-key field, connection
test, and anonymous/authenticated request status. No shared developer key is
shipped. The user will enter their key through the local Settings UI, not chat.

## Implementation

- Settings → Paper sources, addressable through `/settings?section=sources`.
  Following the user's simplification request, one **Save & test connection**
  button saves/replaces the key first, then tests it. With an empty field and
  an existing key, the same button becomes **Test connection** (no rewrite).
  Removal stays separate. Key configured does not mean connection verified.
  Inputs clear after confirmed saves and never refill
  from server data. Loading, invalid input, pending, denied access, rate limits,
  timeouts, and network failures have distinct handling.
- The key field now has one short helper line: “Your key is saved locally on
  this device.” A collapsed, keyboard-accessible **Storage & privacy** disclosure
  explains unencrypted vault storage and export exclusion. Implementation jargon
  about API responses and shared developer keys is no longer form copy.
- Server-only credentials live at `paperSources.s2.apiKey` in the existing
  `.scispark/settings.json`. The serialized settings writer preserves sibling
  AI/companion/settings data and uses atomic filesystem writes. Credentials
  deliberately do not enter changesets, History, or exports. Storage is local
  plaintext, explicitly disclosed in the form.
- `/api/settings/paper-sources` returns only mode, key source, and presence.
  Strict, header-safe validation; no-store responses; Host/Origin guards on
  writes/probes; no arbitrary key, URL, query, or provider in probe payloads.
  Corrupt settings fail closed without echoing parser snippets into errors.
- Saved vault key takes priority over `S2_API_KEY`. Removal restores environment
  fallback, or anonymous access when none exists. Resolution happens for new
  requests, not just at process startup, in feed, manual/research search and
  citation paths. Successful cached metadata need not be refetched.
- The explicit connection test uses the saved key and a fixed public search
  (`machine learning`, limit 1), not private research or AI. It shares the actual
  S2 search transport. Citation lookups now use that same queue: starts remain
  at least one second apart across searches, references, and probes. Bounded
  retry, Retry-After cooldown and 20-second deadlines remain in place.
  Redirects are rejected on keyed S2 requests. Malformed successful HTTP
  responses cannot yield a verified connection. A 429 neither deletes the key
  nor asserts that it is invalid.

## Verification

- Subsequent privacy-copy follow-up is served from `.next-source-privacy`, build
  `s4wlFmpf5HrqZGlqu_Yz0`, detached PID 6794 on port 3113, same vault. Five
  component tests, focused ESLint, production build/TypeScript, and the focused
  Paper sources production E2E passed. The new browser checks open the default-
  collapsed disclosure with Enter, verify the encryption/export text, collapse
  it again, and check desktop/phone overflow. Desktop/light and phone/dark
  screenshots were inspected. No live source calls or credential changes.
  The broader suite numbers below describe the preceding combined-button run.
- Final combined-button Webpack production build: `.next-source-save-test`, build
  ID `08N4G7fDIhC5w_PQAJ7Oj`. TypeScript and focused ESLint passed. The preceding
  full ESLint run had zero errors and the existing `ConnectAiCard`
  hook-dependency warning.
  Port 3113 serves this artifact as detached PID 5558 (parent PID 1), with
  Home and the paper-source settings API both verified HTTP 200.
- Regression suite: 2,290 passed, 15 intentionally gated skips. Focused tests
  cover redaction, export exclusion, concurrent settings preservation, hot
  replacement/removal/environment fallback, corruption, all source call sites,
  safe status/error messages, and cross-origin/forged requests.
- Four new component regressions cover save-before-test ordering, no probe after
  failed saves, retained keys after 429/network failures, empty-field retesting,
  accurate pending labels, and duplicate-submission protection.
- Shared default-transport test verifies S2 search + citation + connection-test
  request starts at 0, 1, 2, and 3 seconds with controlled fetch and fake time.
- Production browser suite covers real settings API/filesystem save, reload,
  empty password field after save, automatic tests after save/replace, 429 preservation,
  successful probe display, removal, and desktop/light + phone/dark layouts.
  External probe responses are intercepted; fake keys never leave the test.
- All 17 Playwright tests passed against the final production artifact above.
  Desktop/light and phone/dark screenshots were inspected for readable copy,
  consistent existing Settings styling, reachable controls, and no overflow.
- The real human-test Settings screen was opened and visually inspected on
  port 3113. Its existing profile and cached feed remain intact; no key was
  entered on the user's behalf. No live connection test or paid-provider gate
  was run.

## Acceptance boundary

A successful authenticated request with the user's real S2 key is still pending.
The earlier anonymous paced diagnostic remained HTTP 429; this change adds
personal authentication, not a guarantee that Semantic Scholar never throttles.
The saved feed is not regenerated or its historical warnings rewritten.
No commit, push, merge, paid-provider gate, or release was performed.
