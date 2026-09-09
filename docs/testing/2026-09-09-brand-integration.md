# Brand integration into the existing product

## Scope and correction

The user explicitly asked to keep the current real UI. The prior editorial
mockup is superseded. The corrected design.md records the existing warm palette,
Halant/Geist typography, radii, layout, navigation and interaction vocabulary.
No replacement page layouts, card system, headings or marketing copy were applied.

## Changes verified

- One BrandLogo component displays the supplied original artwork in Sidebar
  and MobileNav. Black/reversed-white rendering was visually checked on the
  actual warm light/dark surfaces. The copied source hash matches the original.
- Existing page backgrounds, cards, border colors, font families, type sizes,
  spacing and radius tokens are retained. Desktop rail and mobile-bar dimensions
  are retained. The image fits beside the existing header controls.
- Light muted text changes from #94877C to #716559. Contrast on the existing
  card surface improves from 2.85:1 to 4.62:1.
- Small orange text uses --accent-ink (#A64717 light, #FB923C dark), independently
  of the unchanged #F97316 action fill. Hover text uses #87380E / #FDBA74.
- Orange filled controls use --on-accent (#2B180A in both themes). Contrast on
  the existing action fill improves from 2.80:1 for white to 6.05:1.
- Shared and bespoke consumers use the new foreground roles. Changes across
  those files are token substitutions, not layout changes. Existing categorical
  chart/feed color roles are preserved. The actual RealFeedCard uses pale
  category fills with primary text, not the old saturated-white-label pattern
  still described in an outdated CSS comment.
- Shared Button and ThemeToggle focus rings use the readable accent role.
- Agent guidance and the frontend document now point to the corrected contract.

## Browser evidence

`e2e/brand-audit.spec.ts` is opt-in and uses the repository's disposable-vault
runner, loopback-only endpoints, local mock configuration, and an illustrative
profile. It restores profile/settings state afterward. No personal vault,
live model spending or public deployment is involved.

Nine actual routes were captured at 1440x960 and 390x960 in light and dark:
Home, Wiki, Sparky, Projects, Settings, Trending, Spark, History and Graph.
This is **36 combinations before and 36 after**. Captures wait for loading text
to clear; the initial placeholder-only capture was replaced. The final after
run asserts source image loading and its accessible name. Page-level horizontal
overflow checks passed. Desktop collapse/reopen and mobile menu open/close passed.
The local-font regression passed on desktop and phone with external requests
blocked. Real light/dark desktop Wiki and phone Wiki/settings screenshots were
visually inspected, including the wordmark at actual header size.

The first combined audit/font run exposed audit-fixture leakage: its example
profile made the later onboarding test redirect. Added try/finally restoration
of the profile and settings; both tests passed together afterward.

Local evidence is in `/tmp/scispark-brand-before` and
`/tmp/scispark-brand-after`; selected before/after images and both JSON reports
are retained under the task's `real-product-brand-audit` visualization directory.

## Checks

- Full Vitest: 2,575 passed, 17 gated skips (263 passing files, 3 skipped).
- Focused final hover/contrast and primitive checks: 7 passed.
- Final Chromium audit plus local-font regression: 2 passed.
- TypeScript: passed.
- ESLint for src/app, src/components and the new audit: zero errors; one existing
  ConnectAiCard applyPreset hook-dependency warning.
- Production webpack build: passed in isolated `.next-brand-audit`.
- Source asset SHA-256 equality and `git diff --check`: passed.

The build's automatic addition of its temporary types directory to tsconfig.json
was removed afterward; the existing configuration was preserved.

## Explicit limits and remaining audit work

- The header artwork is raster-backed. A clean source SVG and a dedicated
  small-size favicon/app-icon export remain asset work; no vector is fabricated.
- The sampled vault is small. Full populated-feed/graph states, long research
  reviews, source PDFs, every dialog/error/partial state and exports are not
  comprehensively visually audited by these 36 combinations.
- The color tests verify opaque text on the four principal surfaces, not every
  transparent overlay, chart mark, custom semantic color or disabled state.
- 200% browser zoom, screen-reader use and all essential input boundaries still
  require a dedicated accessibility pass. These results are not a WCAG
  conformance claim.
- Some existing narrow headers and settings tab strips rely on internal
  scrolling/clipping. No-page-overflow does not prove all actions fit visibly.
  This branding pass preserves that structure; mobile action reachability needs
  focused review before making broader accessibility claims.
- The user's running app/server and vault were not restarted or migrated.
  Changes are local and uncommitted; no deployment or release is claimed.

## Follow-up: update the actual server on port 3113

The user reported that the real app still showed the previous UI. Inspection
confirmed that PID 51021 was serving an older production artifact: its HTML
contained neither the new BrandLogo nor the new foreground roles.

At the user's request, that process was stopped and replaced with detached PID
17131 serving `.next-brand-audit`, build `bppOXlufHvDmtfBYPha6o`, on the same
loopback port 3113. The existing vault was verified by a profile-content hash
comparison before replacement and retained at
`/private/tmp/scispark-production-walkthrough-kafjXM/vault`.

Verified after restart: HTTP 200; original-logo asset and data-brand-logo present
in served HTML; --accent-ink and --on-accent present in served CSS; profile,
interests, feedback and saved settings hashes unchanged. The updated browser URL
includes a build-specific query to force fresh navigation. This is a local server
handoff, not a public deployment. Server log: `/tmp/scispark-brand-server.log`.

## Favicon follow-up

Replaced the starter favicon with a small-size optical SVG rendition of the
supplied four-point symbol. SVG switches black/white with the browser color
scheme; ICO contains 16/32/48px black-on-white fallback images. These sizes were
decoded and checked, and Chromium light/dark specimens were visually inspected.
The header wordmark remains the original raster-backed artwork. App-icon/mobile
home-screen artwork and original vector exports are still separate asset work.

Production build `.next-brand-favicon` / `k1J078u0PsYoQWvD82IAU` passed, including
TypeScript. Generator lint and diff whitespace checks passed. Port 3113 now runs
this artifact as detached PID 17746 with the same vault. Served HTML contains
versioned links to `/icon.svg` and `/favicon.ico`; both returned HTTP 200 with
bytes exactly matching the new source assets. Profile and settings hashes remain
unchanged. No public deployment or paid model calls.

## Transparent header-logo follow-up

Replaced the opaque, blended header image with a genuine RGBA PNG extracted
from the supplied editorial logo using imagegen. The asset and exact edit prompt
are documented in `public/brand/README.md`. This is an edited raster; the original
reference remains preserved. Removed multiply/screen blending. Dark mode inverts
only the lettering while preserving alpha, and existing header geometry remains.

Verified transparent pixels, including letter counters, and visually inspected
real desktop/mobile headers in both themes. The focused Chromium test passes for
1440px and 390px widths in light/dark mode, checks normal compositing, and checks
that logo corners match the actual parent surface. Nine Sidebar/AppShell tests
pass, focused ESLint passes, and the production build (including TypeScript) and
whitespace checks pass.

Port 3113 now serves `.next-brand-transparent`, build `LFOO27ST4oaZkUl5ofP76`,
PID 18765. HTTP 200, updated logo references in HTML, and exact served PNG bytes
were verified. Profile, interests, feedback, and saved settings hashes remained
unchanged across restart. This supersedes the earlier opaque-logo implementation.
