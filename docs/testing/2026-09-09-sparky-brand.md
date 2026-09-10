# Sparky visual implementation — September 9, 2026

Implemented the user's confirmed UI direction: abstract four-point spark,
neutral bordered circular badge, 28px beside each chatbot reply, no main chat
header badge, and existing reply cards retained. Assistant labels now say Sparky.
The shared badge also replaces onboarding icons (36px header, 28px replies)
and the floating companion artwork (48px control). Existing controls and
research workflows are retained.

Idle/completed sparks are monochrome; thinking sparks breathe in accessible
orange; streamed text uses steady orange. Reduced-motion disables breathing.
Removed the floating button's idle bob and celebration pulse. Theme colors use
semantic variables. Badge graphics are decorative, preserving existing control
names and reply status announcements.

Validation:
- 63 focused chat/companion/onboarding/theme tests passed; nine onboarding tests
  passed again after the final scroll correction. Targeted ESLint passed.
- Production `.next-sparky-brand-verified` built successfully, including TypeScript.
- Chromium chat test passed at 1440px and 390px in both themes: 28px size,
  monochrome idle, orange thinking/responding, animation and reduced-motion,
  floating 48px size, and no horizontal page overflow. Screenshots inspected.
- Existing onboarding layout checks passed across five viewport sizes, checking
  long conversations, composer reachability, review forms, scroll retention,
  both themes, failure recovery and reload. During verification, form expansion
  exposed a scroll timing race; the follow-to-end effect now runs before paint
  and includes request completion. The final matrix passed four onboarding
  sizes plus chat; the phone case timed out during simulated lost-response
  recovery, then passed unchanged in isolation. This transient test failure is
  retained here rather than reporting a clean single-run matrix.
- No live model calls: browser tests used a disposable vault, local mock provider,
  and a browser-only chat stream fixture. No real research conversation was added.
- Diff whitespace check passed.

The local server on port 3113 now serves build `71Y9XcCm09B4i52JhAKnP`, PID 23031.
HTTP 200 and new badge markup verified. The previous vault was retained; profile,
interests, feedback and settings hashes were unchanged across restart.
Changes are local and uncommitted. This is not a public deployment or a full
accessibility conformance audit.

## Centered start-page follow-up

At the user's request, `/chat` now opens a centered welcome heading and composer
with three existing research modes beneath it. Removed automatic reopening of
the latest conversation; saved transcripts remain available from History, the
sidebar, and an expandable recent list. Source controls are expandable, and
mode selection preserves the typed draft without submitting. Saved transcript
pages retain their bottom composer and cards. Mobile heading fits on one line.

37 chat component tests passed; focused ESLint passed. Production build and
TypeScript passed. Three Chromium tests passed covering new/existing chat
streaming and reload, reader streaming, and the start-page matrix. After the
mobile-only heading adjustment, the start-page test passed again against final
build `.next-sparky-start-final` / `nRmHF3bee-7tAh-BCc3Yd`: light/dark, 1440/390px,
centered input, options below, draft/mode persistence, no requests on mode changes,
submission payload, failure draft retention, saved-chat navigation, no horizontal
overflow, and single-line phone heading. Screenshots visually inspected.

Port 3113 now runs PID 23981 with the final build. Actual browser confirmed the
start page and all three research options. Protected vault/settings hashes stayed
unchanged across restart. No live model calls, public deployment, commit or push.

## Compact options follow-up

Removed the oversized pill-shaped conversation-options container. The setting
now uses a compact, maximum-440px row: “Saved papers only”, a separate explanation,
and a switch with a visible thumb. Native checkbox semantics, accessible label,
description, keyboard focus and Space activation are retained. The shared toggle
also improves existing conversation controls without changing source filtering.

37 chat tests passed with the updated copy assertion; build/TypeScript and targeted
lint passed. Chromium start-page matrix passed, including mouse and keyboard
switch activation and expanded-panel screenshots in desktop/mobile light/dark.
Port 3113 serves `.next-sparky-options` / `khWQj9ugB9bFOCRkW4vMo`, PID 24616.
Protected files were unchanged across restart. Changes remain uncommitted.

History links on both the start page and conversation header now use the same
Lucide Clock icon as the sidebar, with a decorative 16px icon beside the label.
Lint, production build/TypeScript, whitespace and actual-browser icon checks
passed. Port 3113 now serves `.next-sparky-history-icon`, build
`WrXvq3D0v4LLeoHd6P7Zf`, PID 24948; protected files unchanged across restart.

## Floating quick chat

The floating Sparky now opens a compact nonmodal chat panel on Home and other
surfaces where the companion is mounted. Uses the existing chat API, streaming
renderer, grounded message cards and save-to-knowledge-base action. No new model
or storage path. A full-conversation link appears after a saved reply. Closing
hides rather than unmounts the panel, preserving its draft and in-flight reply;
Escape returns focus to the launcher. Queued proactive messages and feedback
are hidden while chat is open rather than discarded.

49 chat/companion tests, targeted ESLint, build/TypeScript and whitespace checks
passed. Chromium used a disposable vault and local mock model to verify opening
from idle, initial focus, Escape/focus return, draft retention, actual streaming,
close/reopen during a reply, saved-transcript navigation and containment in
1440px/390px light/dark layouts. Screenshots visually inspected. This does not
claim live model validation or persistence of unsent drafts after a page reload.

Port 3113 now serves `.next-sparky-quick-chat`, build `6V6_XvrwThVLMkdvK-hp9`,
PID 25657. Actual Home launcher was clicked and its dialog verified without
sending a message. Protected vault/settings files unchanged across restart.
Changes remain local and uncommitted.

## White labels on orange fills — user override

Changed shared `--on-accent` to white in both themes at the user's explicit
request, affecting orange-filled controls, selected tabs, icons and initials.
Retained the bright orange fill and existing disabled opacity. Updated the design
contract and test expectation honestly: this pair does not meet the former
4.5:1 normal-text contrast target, which is no longer asserted for this pair.
Other text contrast assertions remain intact. Five token tests and production
build/TypeScript passed. Actual browser computed colors verified white foregrounds
on Home in both themes without changing saved settings. Port 3113 now serves
`.next-white-orange-labels`, build `ES1SRiRbzdl7uc91ZCb7x`, PID 25966. Protected
files unchanged across restart; changes remain uncommitted.

Renamed the sidebar's Spark label to Idea Spark at the user's request; `/spark`
and its icon are unchanged. Six sidebar tests, production build/TypeScript and
actual browser link verification passed. Port 3113 now serves
`.next-idea-spark-label`, build `ny8n3KAbYxbSDBHaEuTIu`, PID 26712. Protected files
unchanged across restart.

Favicon now matches the user's square-tile reference: black spark with inner
padding, white rounded-square background and subtle edge. SVG and 16/32/48px ICO
share the same artwork across themes. Generator lint, build/TypeScript, served
byte checks for both formats and rendered specimen inspection passed. Port 3113
serves `.next-square-favicon`, build `4iW7ZXDxoK3YcKXy0Y34x`, PID 27280; protected
files unchanged across restart.

Reduced the shared conversation textarea radius to 12px at the user's request,
including floating quick chat. Production build/TypeScript passed, and the actual
Home popup's computed radius and rendered input were checked. Port 3113 serves
`.next-chat-input-corners`, build `QSGNu8D6oqqjsikkNi8_P`, PID 30454; protected
files unchanged across restart.

Changed the shared conversation input's native blue focus outline to the semantic
orange foreground in both themes. Production build/TypeScript passed; actual
focused quick-chat input colors verified after theme transitions settled.
Port 3113 serves `.next-chat-orange-focus`, build `e74QX76kprtbM5FeyjKfa`, PID
30953; protected files unchanged across restart.

## Orange-family paper headers

Replaced the Home feed's translucent green/teal category bands with dedicated
opaque warm theme tokens: peach findings, apricot methods, soft terracotta
reviews, pale amber data/tools, with dark counterparts. Kept category labels,
classification logic, grain and card layout. Seventeen card/token tests passed,
including 4.5:1 label contrast on all four surfaces in both themes. Production
build/TypeScript and targeted ESLint passed. Chromium rendered four fixture
categories at 1440/390px in light/dark, checked distinct nontransparent fills and
no page overflow; desktop screenshots visually inspected. No live model calls.

Port 3113 now serves `.next-orange-paper-headers`, build `e7RtaFCBd8Yc8CSqFNnUV`,
PID 31820. Protected files unchanged across restart. Changes remain uncommitted.

Clipped the account dropdown contents to its rounded border so Profile/Settings
hover backgrounds cannot overflow. Added inset orange keyboard focus and matching
focus background to both entries. Lint, build/TypeScript, rendered hover specimens
and keyboard Tab focus checks passed. Port 3113 serves `.next-profile-menu-clip`,
build `54hiwm4zsFkNpy5n7Vi5a`, PID 32241; protected files unchanged across restart.
