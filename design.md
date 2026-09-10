# SciSpark design system

## Governing decision: preserve the real product

**2026-09-09 user correction:** “i do like the current UI in general … we should
start with the current real product UI design, don't re-design the UI”.

The current application is the design baseline. Integrate the supplied logo and
make evidence-based consistency/accessibility corrections in that UI. Preserve
its navigation, information hierarchy, page composition, cream/espresso identity,
Halant/Geist fonts, card shapes, density, interactions and product personality.

The earlier editorial-journal mockup and its proposed neutral palette, compact
rows, reduced radii and new page headings are **superseded**, not implementation
references. Its preliminary approval was corrected by the user's instruction
above. The static preview is not the actual application and must not guide rollout.

## Product scope

SciSpark is a local-first research web app for literature discovery, reading,
annotation, personal knowledge management, source-grounded chat, review and idea
creation. The local runtime owns the vault, model calls and research mutations.
Visual changes must preserve sources, evidence limits, cost disclosures, recovery,
version history and undo. Attractive output is not evidence of scientific validity.

## Brand sources

The design system is derived from five user-supplied sheets. Originals are kept
locally in the gitignored `design/` folder; they are not required to build or run
the app. Preserve them when present. The tracked production wordmark is
`public/brand/scispark-wordmark-transparent.png`; the favicon is `src/app/icon.svg`.

| Reference | Use |
| --- | --- |
| Editorial logo | Canonical letterforms, four-point spark, tagline |
| Primary variants | Formal lockup and reversed version |
| Horizontal variants | Navigation placement, including wordmark without tagline |
| Symbol variants | Spark for compact identity and favicon preparation |
| Usage guidelines | Monochrome default, orange #E7803F, clear-space intent |

Use black identity on light backgrounds and reversed white on dark backgrounds.
The orange variants are alternatives; the usage sheet explicitly prefers
monochrome logos. Do not use orange as the default wordmark. “Igniting Knowledge”
is a brand tagline, not copy to add to every application screen.

The sheet does not identify the logo typeface. Do not substitute Halant lettering,
a generic sparkle icon, or a generated approximation for the supplied artwork.
The letterforms and the spark above the i are the identity being integrated.

### Header integration

Replace the existing typed SciSpark label in the sidebar and mobile header with
one shared logo component. Preserve the collapse/menu/theme controls and their
positions. Keep the current collapsed rail's behavior; do not replace its collapse
button with an unrelated brand action. Keep accessible SciSpark identification
without announcing both the container and its decorative image.

Use the wordmark without the tagline in the narrow existing header. Do not
shrink the complete presentation sheet into this space. Use a real alpha-channel
asset so the surface is visible around and inside the lettering. Do not use
multiply/screen blending to hide an opaque paper background: the first version
showed a visible mismatch and was rejected by the user. The current transparent
PNG was extracted from the supplied reference with the built-in imagegen tool,
then visually checked. It is an edited raster asset, not an original vector.
A clean original SVG remains the preferred future source. Framework image
optimization must preserve alpha, and dark-mode reversal must affect only ink.

The printed sheet's multi-letter logo sizes down to 24–48px are not usable
minimum widths for the app. Judge the actual header at desktop and phone size,
including its spark and letter stems. Omit the tagline before sacrificing the
wordmark. Formal lockups retain the sheet's capital-S clear-space rule; compact
navigation receives an optical spacing check within its existing bounds.

## Typography: keep the current families and hierarchy

Use src/lib/fonts.ts and the licensed fonts in src/assets/fonts. All font loading
must remain local; no CDN or build-time download dependency.

| Role | Existing family | Baseline rule |
| --- | --- | --- |
| Headings | Halant, regular/bold | Preserve existing page and card hierarchy |
| Body, navigation, controls | Geist Sans | Preserve current scale and density |
| Code, identifiers, numeric data | Geist Mono | Tabular numerals for aligned values |
| Logo | Supplied artwork | Separate from application typography |

The existing shared PageHeader is 28px; controls commonly use 13–14px and metadata
11–13px. Preserve those sizes unless actual reading/zoom checks demonstrate a
problem. Do not globally replace titles with larger editorial display headings.
The existing heading/body tracking values are baseline implementation values,
not a requirement to introduce tight tracking into new scientific text. Audit
crowded small labels and long passages in context before changing tracking.

Never create a one-word second line when the original text can fit. Avoid
unnecessary width caps; use sentence boundaries for intentionally wrapped short
copy. Long paper titles and DOI/URL strings must remain readable and recoverable.

## Color: retain the warm interface; separate fill from readable text

src/app/globals.css owns colors. Components use semantic Tailwind aliases.
Preserve the existing light and dark surface palettes:

| Role | Light baseline | Dark baseline |
| --- | --- | --- |
| Page | #FEFAF5 | #161009 |
| Sidebar / warm region | #F6F0E9 | #1E150C |
| Card surface | #EFE7DD | #2B1E11 |
| Light surface | #FAF6F2 | #241A10 |
| Primary text | #2B180A | #F4EAD9 |
| Secondary text | #3E2407 | #E6D6C0 |
| Border | #E8D3C0 | #3C2C1B |

The supplied brand orange is #E7803F; the existing application action orange is
#F97316. This distinction is recorded rather than used as a reason to recolor
the entire product. The initial integration keeps the established action fill.
A future hue alignment must be a deliberate, visually reviewed token change.

Accessibility corrections may change the foreground used on those surfaces:

- Normal text needs at least 4.5:1 contrast; large text and essential control
  boundaries need at least 3:1. Check actual rendered combinations and opacity.
- Orange fill and orange text need separate roles. A color that works behind a
  dark button label may fail as small text on cream.
- User override (September 9): use white `on-accent` text and icons on orange
  controls and profile initials in both themes. Keep the existing orange fill.
  This supersedes the earlier dark foreground; white on this bright orange does
  not meet the 4.5:1 normal-text contrast target. Do not claim these controls pass
  that target. Disabled controls retain their existing reduced opacity.
- Metadata must stay readable on all existing surfaces. Do not turn labels into
  unreadable low-opacity text to make the UI look quieter.
- Preserve distinct categorical graph and feed colors and their meaning. Audit
  their labels separately; do not replace colorful existing cards with a neutral
  list or remove community encodings.
- Preserve real focus outlines, hover/pressed/selected distinctions and input
  boundaries. A faint decorative separator cannot substitute for a control edge.
- Never infer success, confidence or validation from brand orange. Pair research
  status and chart color with text, icons, shape or a legend.

Contrast examples from the supplied brand: white on #E7803F is 2.78:1; #171717
on that orange is 6.45:1. The new logo remains black/white independently of the
existing UI action fill. SVG/canvas plots retain their theme-resolution helpers.

## Layout, components and motion: preserve first

The real AppShell owns the layout: 240px expanded / 60px collapsed desktop rail,
main workspace, existing right panel, and 50px mobile top bar below the 1024px
breakpoint. Preserve these dimensions and navigation patterns.

Keep the current shape tokens: card 28px, badge 8px, button 12px, pill 50px,
FAQ/panel 16px. Existing cards, page spacing and content density are the baseline.
Do not replace them with the previous preview's compact rows or 6px buttons.
Preserve the existing motion character, while honoring reduced motion and keeping
focus, reading position, selection and streaming stable.

Shared Button, Chip, Card, PageHeader, inputs, dialogs and empty/loading/error
states should agree on semantic colors and typography. Fix a shared primitive
when the defect is shared; inspect bespoke consumers before assuming the fix
covers every screen. Keep the companion's personality and controls. A new logo
is not authorization to redesign Sparky or remove the mascot.

## Whole-product audit coverage

Audit existing implementations, not illustrative replacements. Track “inspected”,
“issue found”, “fixed” and “verified” separately. Screenshots with empty data do
not establish acceptance for populated or error/partial states.

| Area | Current surfaces | What to check without redesigning |
| --- | --- | --- |
| Shell and identity | Sidebar, MobileNav, ThemeToggle, RightPanel | Artwork, spacing, accessible names, both themes, collapse and mobile menu |
| Discovery | /, /papers, /paper/[key] | Existing cards, badges, title hierarchy, labels, source metadata |
| Reading | /reader | Source fidelity, toolbar contrast, annotations, long text and selection |
| Knowledge | /wiki, /wiki/[...id], /wiki/inbox; /library redirect | Current shelf/tree/editor, type labels, backlinks, review and undo |
| Projects | /projects, /projects/[id] | Existing project cards, forms, membership and scoped context |
| Sparky and reviews | /chat, /chat/[id], ReviewBlock | Citation/status legibility, streaming, partial results, controls and versions |
| Ideas | /spark | Existing seeds, progress, Quick/Deep distinctions and cost confirmation |
| Trends and graph | /trending, /viz | Current layouts, feed/chart categories, legends, labels and inspectors |
| Preferences | /settings, /profile, SettingsModal | Forms, switches, avatar, focus, errors, key redaction and unknown cost |
| First run | /setup, /onboarding | Existing onboarding flow, logo, small labels, focus and errors |
| History and diagnostics | /history, /debug/* | Status/readability, recovery, identifiers and timestamps |
| Cross-cutting surfaces | Dialogs, companion, empty/error/loading states | Component consistency, recovery and keyboard access |
| Export/browser identity | Reports, favicon, social assets | Clean artwork, source/version/status labels; asset work tracked separately |

The separate public marketing repository is outside this implementation. Share
this contract with it when asked; do not claim it changed from work in this repo.

## Verification and change boundaries

1. Capture the real product before changes using the disposable-vault E2E runner.
2. Integrate original artwork into the existing header. Check both themes,
   desktop/mobile and expanded/collapsed navigation at actual rendered size.
3. Record contrast/component inconsistencies and apply only targeted fixes.
4. Capture the same routes, viewport sizes and themes after changes. Confirm
   layout and interaction continuity, no cropping/overflow and readable branding.
5. Run focused regression, semantic-token and no-raw-hex checks, then type/build
   checks appropriate to the implementation. No paid model calls are required.
6. Report sampled evidence and outstanding states honestly. Do not equate a set
   of screenshot checks with a complete WCAG conformance assessment.

The old preview at ~/.gstack/projects/scispark-paper-manager/designs/
design-system-20260909/preview.html is historical and superseded. Its tests
validate that mockup only and provide no product acceptance evidence.

## Current implementation and audit

The transparent wordmark is integrated through the shared BrandLogo component in
the real sidebar and mobile header. Existing layouts, font families and sizes,
warm surfaces, action orange and shape tokens are preserved. Readable foreground
roles now distinguish orange fills, orange text and text on orange; light muted
text is strengthened. See [the real-product audit](docs/testing/2026-09-09-brand-integration.md)
for evidence, source provenance, verification and remaining accessibility scope.

The browser favicon is implemented in `src/app/icon.svg`: a small-size optical
vector rendition of the supplied four-point symbol: black on a white
rounded-square tile in both browser themes (user reference). It is favicon-specific artwork,
not a claim to possess the original logo vector. `src/app/favicon.ico` provides
16/32/48px black-on-white fallbacks, reproducibly rendered by
`scripts/generate-favicon.mjs`. Both are registered through Next's file-based
metadata with content-versioned URLs. The favicon stays the same across browser
and application appearance settings. The header wordmark is unchanged.

## Decisions log

| Date | Decision | Authority |
| --- | --- | --- |
| 2026-09-09 | Use supplied artwork, not competitive research | User |
| 2026-09-09 | Preserve the current real product UI; no redesign | Latest explicit user correction, supersedes mockup direction |
| 2026-09-09 | Integrate logo and audit fonts, colors, themes and components in place | User's corrected scope |
| 2026-09-09 | Keep existing warm surfaces, shape, density, typography and app structure | Direct consequence of preserve-current-UI scope |

## Sparky identity — approved September 9

Sparky is an abstract four-point spark closely following the logo symbol, with
no face, limbs, or accessories. Use the shared `SparkyBadge` in chat replies,
onboarding, and the floating companion. A quiet neutral circle with a subtle
border contains the spark in both themes. Replies use a 28px badge and 16px spark,
aligned to the card top with a 10px gap. Keep existing reply cards and typography;
label assistant replies “Sparky”. The main chatbot has no header badge (option B).
Retain the onboarding header's 36px badge and the floating control's 48px target.

At rest and on completed replies, the spark is black in light mode and white in
dark mode. While thinking it uses the accessible orange foreground and gently
breathes over 2.4 seconds with a maximum 1.12 scale. While text is streaming it
stays steady orange. Only the spark moves; the circle stays still. Reduced-motion
preferences disable breathing. Remove idle bobbing and celebration pulses.
State follows existing request/stream state; no research behavior is changed.

### Sparky start page — September 9 layout follow-up

The user explicitly requested a ChatGPT-like starting layout, superseding the
preserve-layout rule for the empty chat entry only. `/chat` opens a centered
question heading and a large composer, followed by the existing Discuss research,
Find papers, and Deep literature review options. These select a mode without
submitting or replacing the user's draft. Source settings and recent conversations
remain accessible through disclosures. Keep SciSpark fonts, warm surfaces and
existing navigation. Saved conversations retain reply cards, Sparky badges, and
the bottom composer; direct conversation links continue to reopen their transcript.

### Floating quick chat

The user requested that clicking the floating Sparky on Home immediately open a
small chat box. The shared floating control now toggles a nonmodal 400px chat
panel, capped to the viewport, rather than doing nothing when idle. Keep the
48px launcher, existing chat backend, grounded reply cards and source links.
Escape or Close returns focus to the launcher. Closing preserves the in-memory
draft and response in progress. Saved replies link to their full conversation.
Existing proactive suggestions and feedback remain queued behind an open chat.

### Paper-card header palette — September 9 user update

Home feed headers use an orange-family palette by existing content category:
research findings in peach (#FCE2CE), methods in apricot (#F4CCA8), review/synthesis
in soft terracotta (#F2D7C8), and data/tools in pale amber (#F8E8C6). Dark variants
are #452918, #50301A, #442C24 and #42341A, respectively. Use dedicated
`paper-header-*` semantic tokens, retaining category text and the existing grain.
Header labels retain theme text color and pass 4.5:1 on these surfaces. This
supersedes the former pale green/teal feed headers; graph and other categorical
visualizations keep their existing palette. No category inference logic changes.
