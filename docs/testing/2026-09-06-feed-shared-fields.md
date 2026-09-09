# Shared research fields for Feed — September 6, 2026

## Behavior

- Each Feed refresh reads the saved, explicitly selected Trending fields and
  optional subfields from server-owned vault settings. There is no second copy
  of this preference in the profile or browser state.
- Search planning and evidence-based relevance assessment both receive the
  canonical selection and the existing diversity setting. Selected subfields
  are the interests; their parent provides context. Without selected children,
  the whole field is an interest. Automatic Trending derivation alone does not
  silently add an explicit Feed interest.
- Feed treats selections as soft topic interests, not strict taxonomy filters
  or an extra numeric bonus. Papers without OpenAlex IDs remain eligible;
  leaving a field unchecked is not a negative preference. Explicit profile
  constraints, existing relevance thresholds, feedback semantics, enabled
  sources, diversity selection and numeric weights remain unchanged.
- All selected leaves reach assessment even when the existing 20-profile-topic
  cap is full. Selected interests also guide planning-memory retrieval.
- Planning failure interleaves profile interests and selected fields across
  enabled sources within the existing eight-query budget. Invalid saved
  selections produce a review warning rather than silently broadening a subset.
- Feed cache metadata records the selection used for that run, without secrets.
  Existing caches remain readable and stay unchanged until a successful refresh.
  Saving selections alone does not make AI or source calls.
- README documents the shared selection and the strict Trending versus soft
  Feed distinction. Frontend-design guided a brief Settings note using the
  existing semantic styling; each short sentence fits its own line on phone.

## Verification

- Vitest: 2,375 passed, 15 gated skips (245 passing test files).
- TypeScript: passed, including after the final browser-test adjustment.
- Repository ESLint: zero errors; one existing ConnectAiCard useEffect
  dependency warning for applyPreset. Focused ESLint passed.
- Production Webpack build passed: .next-feed-shared-fields,
  build iVk6qVXIX1aJAcer_0oAe.
- All 21 Playwright tests passed against that production artifact with a
  disposable vault. Source and AI responses were controlled fixtures, not a
  real-provider recommendation-quality evaluation.
- New browser coverage saves a selected subfield through Settings, then runs
  the real Feed orchestrator using the persisted settings, checks both model
  inputs, verifies the resulting paper and readable explanation in Home, and
  confirms cached results survive reload. Only external AI/source calls are
  substituted. The test also checks the Settings note on a 390×844 phone.
- Unit/API coverage includes all diversity modes, changes between runs,
  whole-field selection, selected topics beyond the profile cap, planning
  fallback, feedback-memory selection, missing taxonomy identifiers, invalid
  selections and ignoring client-forged field preferences.
- Desktop/light Feed and phone/light Settings screenshots inspected. The new
  Settings sentences fit without horizontal overflow; raw preference metadata
  is not shown on Home.
- The first focused browser run completed the product flow but exposed an
  incorrect test-cleanup assumption: source choices use the dedicated
  /api/settings/paper-sources endpoint, not the generic settings response.
  Corrected the fixture setup/cleanup and reran focused and full suites green.
- git diff --check passed.

## Local handoff

Port 3113 serves the tested artifact as detached PID 34147, preserving
/tmp/scispark-production-walkthrough-kafjXM/vault. The Settings page returned
200 with the expected build ID, and the settings API returned 200.

The human profile, photo, keys, selections and current Feed were not edited by
these tests. No paid AI calls, live paper searches, commit, push or release.
Reload the browser, then use Refresh feed to apply the selection to a new run.
