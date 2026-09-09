# Field-first Trending selection — September 6, 2026

## Behavior

- Choose up to three general fields first. Only selected fields get an optional,
  initially collapsed subfield panel; there is no flat 252-option picker.
- Select multiple children to narrow a field to their union. No children means
  the whole field. Include entire field clears the subset; removing a parent
  removes its children. Saved subsets reopen collapsed with readable labels.
- Frontend-design guided progressive disclosure and semantic theme styling.
  Settings search is local and only searches the 26 parent fields.
- The bundled catalog was fetched from both pages of OpenAlex's public
  subfields endpoint: 252 unique IDs with verified parent field IDs.
- Settings canonicalize IDs, validate parent membership and duplicates, and
  preserve invalid stored subsets for explicit repair rather than broadening.
- Counts, grouped topics, both date windows, representative papers and breakouts
  carry the same parent plus optional child-union filters.
- Cache matching includes child sets, independent of selection order. Existing
  whole-field version-5 boards remain compatible; subset edits invalidate them.
- README explains selection, storage semantics and retrieval/cache behavior.

## Verification

- Vitest: 2,359 passed; 15 gated skips.
- TypeScript: passed.
- Focused ESLint: passed. Repository ESLint: zero errors, one existing
  ConnectAiCard useEffect dependency warning (applyPreset).
- Production Webpack build passed: .next-trending-subfields,
  build ZH0b4fh2GUncBsTQcbhuD.
- All 20 Playwright tests passed against that production artifact, using a
  disposable vault and controlled AI/source fixtures.
- New browser coverage: parent-first rendering, keyboard expansion, only the
  selected parent's children, multiple selection, Save/reopen, clearing the
  subset, removing/re-adding the parent, real API rejection of cross-parent IDs,
  readable board scope and refresh after child-scope changes.
- Desktop/light (1440×1000) and phone/dark (390×844) screenshots inspected in
  collapsed and expanded states. No horizontal overflow. Long taxonomy labels
  wrap within their controls; the two helper sentences start on separate lines
  on the phone layout.
- A separate public, keyless OpenAlex request returned HTTP 200 for field 28
  with subfields 2805|2809, non-paratext and August 2026 dates. All five sampled
  works matched the selected parent and children. No user profile or keys sent.

## Local handoff

Port 3113 now serves the tested build as detached PID 24624, preserving
/tmp/scispark-production-walkthrough-kafjXM/vault.

No human profile, photo, preferences or keys changed by the tests. No paid AI
calls, commit, push or release.
