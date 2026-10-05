# Rounded content boxes

User direction: content boxes should read as rounded rectangles; pill shapes
belong to action buttons. This supersedes retaining pill-shaped content labels.
The rule is recorded in `design.md`.

## Applied changes

- Paper and wiki references use full-width, left-aligned boxes with 12px corners,
  wrapping text and visible keyboard focus. Onboarding question suggestions use
  the same radius rather than pills.
- Chat replies and streaming placeholders use 16px corners. Selection toolbars,
  popovers, notices, dropdowns and the graph search input use box radii.
- The shared Chip and bespoke source/type/status labels across discovery, wiki,
  history, projects, ideas, settings and graph inspection use 8px badge corners.
- Action buttons retain their pill appearance. Existing typography, color,
  research operations, source destinations and saved data are unchanged. Avatars,
  spark identity and diagram/status/toggle shapes retain their existing roles.

## Verification

- TypeScript passed; ESLint has zero errors and the single pre-existing
  ConnectAiCard exhaustive-deps warning.
- Vitest: **2,700 passed / 19 skipped**; no tests added or removed. Updated the
  existing primitive test's Chip radius expectation.
- Production build `.next-rounded-content` passed and is running at
  localhost:3000 with the scheduler off.
- Three existing production browser checks passed: paper context/history,
  selection-to-Sparky recovery and cached PDF reading. The paper-context fixture
  now has a long title to exercise wrapping at 1440px and 390px. Its first run
  missed the mock-provider title marker; the corrected fixture passed.
- Inspected the actual saved CNNT conversation in the local vault. Its SGAD
  reference has 12px corners and Save to knowledge base retains its pill shape.
  No new research question or save action was submitted in that vault.
- Inspected desktop and phone screenshots of the floating panel using disposable
  test data. The complete title wraps inside a rounded box without overflow.
  Phone-width evidence is from Playwright: the in-app browser's temporary
  viewport override did not report the requested CSS width and was reset.

Screenshots:

- Actual saved chat: `/Users/tongshan/.codex/visualizations/2026/09/13/01a098e1-d370-74b1-b71f-99b0627f2b38/rounded-content/saved-chat-desktop.png`
- Floating panel, test data: `.../rounded-content/sparky-1440.png` and `.../rounded-content/sparky-390.png`

No commit or push was made.
