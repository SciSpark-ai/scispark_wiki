# Avatar camera control — September 6, 2026

- Replaced the separate Add/Change photo row with a 32px camera button on the
  bottom-right of the existing 96px profile avatar. It is available without
  opening Edit profile first; selecting a file enters the existing draft flow.
- Save changes, Cancel, image type/size validation and Remove photo are retained.
  Opening the picker does not write the profile. The camera has an accessible
  name, format/size guidance for assistive technology and visible keyboard focus.
- Frontend-design guided a compact, theme-aware control; the extra avatar and
  upload card are removed. No server API or storage format changes.
- Full Vitest: 2,343 passed, 15 gated skips. TypeScript, focused ESLint and
  production Webpack build passed.
- Added a disposable-vault browser regression for Enter-to-open file selection,
  invalid type/oversize rejection, draft cancellation, save/reload, removal, and
  exact bottom-right positioning on desktop/light and phone/dark layouts.
- Production artifact: `.next-avatar-camera`, build
  `1qdlc5cyDnKb_fgA61uMY`.
- All 18 existing browser tests passed on that artifact. The new avatar test
  first hit an ambiguous alert locator (Next's route announcer also has that
  role); scoping it to main fixed the test, and the complete new avatar test
  passed on rerun without any application/build changes.
- Inspected screenshots with both initials and an uploaded fixture on
  desktop/light and phone/dark; no horizontal overflow.
- Port 3113 serves this build as detached PID 22229, with the unchanged
  `/tmp/scispark-production-walkthrough-kafjXM/vault`.

No real user photo, profile or key is changed by the tests. No paid AI calls.
