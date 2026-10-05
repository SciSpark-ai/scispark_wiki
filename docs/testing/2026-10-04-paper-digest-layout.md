# Paper digest layout — October 4, 2026

User-requested redesign of `/paper/[key]`, retaining SciSpark's approved brand.

- Compact title/metadata/actions header; generated digest leads the reading area.
- One 70ch reading measure, 16px body prose, distinct 24px section headings.
  Methods and Limitations read sequentially instead of side by side.
- Key points retain an emphasized surface. Desktop section links occupy a slim
  sticky rail; a workspace container query avoids squeezing the article when the
  sidebar is expanded. Smaller screens have a keyboard-accessible contents menu.
- Original abstract remains intact in a native disclosure, initially open when
  there is no digest or synthesis. Saved-paper/project context remains available.
- Existing cache, generation, save, feedback, ingest/undo and selection logic is
  unchanged. Browser regression uses only local fixture model calls.

Verification:

- TypeScript and production build passed (`.next-digest-final`).
- Full Vitest: 2,660 passed, 19 gated skips. Repo source guards passed.
- ESLint: zero errors, the existing ConnectAiCard exhaustive-deps warning only.
- The new browser regression reproduced the old side-by-side reading defect.
  Final production gate passed both digest layout and cached Trending-to-paper
  reading/Ask scenarios using a disposable vault and local provider fixture.
- Layout checked in light/dark themes at 1600, 1280, 1200, 1024, 768 and 390px, with a
  long title and long prose: no horizontal overflow, consistent reading width,
  keyboard source disclosure, section-link focus/scroll, saved context, cache
  hydration without regeneration, and selection actions. The initial no-call
  assertion was narrowed to paper/reading calls because the shell also performs
  its ordinary companion checks.
- Desktop, mobile, both themes and scrolled Methods/Limitations screenshots were
  inspected. Evidence is local under the task's `paper-digest-2026-10-04` folder.

The real saved SGAD digest was also reopened in the updated local preview;
its cached content and working section navigation were visually confirmed.
