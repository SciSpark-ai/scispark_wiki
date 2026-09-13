# Ponytail Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete verified-dead code, collapse copy-pasted helpers, and drop four runtime dependencies the platform already covers — with no user-visible behavior change.

**Architecture:** Pure subtraction, ordered safest-first: dead surfaces (Tasks 1–7), then consolidation of identical helpers onto one export each (Tasks 8–11), then dependency removals that need small rewrites (Tasks 12–14), then repo hygiene + docs (Task 15). Every task is independently revertible and ends with `npx tsc --noEmit` + the full vitest suite green.

**Tech Stack:** Next.js 16 / React 19.2 / TypeScript 5 / Tailwind 4.2 / vitest 4 / Node 24.

**Spec:** `docs/superpowers/specs/2026-09-12-ponytail-audit-cleanup-design.md` (findings, evidence, and the five KEEP decisions D1–D5 — read it first; anything not listed there is out of scope).

## Global Constraints

- No user-visible behavior change, except: bubble/drawer **exit** fades become instant (enter fades stay); the Anthropic provider gets the same 120 s request timeout Google already has.
- All repo guards stay green: `src/lib/__tests__/browser-purity.test.ts` (client modules may not import server-only code; new client lib files are listed in its `CLIENT_LIB_FILES`), the no-raw-hex / `bg-white` source guard, the source-hygiene (no control bytes) test, `npm run lint` at **0 errors**, `npx tsc --noEmit`, `npm run build`.
- Node 24 runtime: `AbortSignal.timeout`, `AbortSignal.any`, `Response.json` are native. Tailwind 4.2.2: the `starting:` variant (`@starting-style`) exists. React 19.2: the `inert` boolean prop is supported.
- Baseline before Task 1: `npx vitest run` → **2575 passed / 17 skipped**; `npm run lint` → 0 errors / 1 warning (pre-existing `react-hooks/exhaustive-deps` in ConnectAiCard). The test count only goes down by the cases each task names, and lint must stay at 0 errors **and no new warnings** (an unused import left behind by a deletion shows up as a `no-unused-vars` warning — remove it).
- Work on branch `chore/ponytail-audit-cleanup` off `main`. Leave the untracked `assets/` and `scripts/*brand*`/`export-sci-avatar`/`stack-original-wordmark` files alone (not part of this plan).
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commands: `npx tsc --noEmit` (types), `npx vitest run` (full suite, ~2–3 min), `npm run lint`.

---

### Task 0: Branch

**Files:** none

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only && git checkout -b chore/ponytail-audit-cleanup
```

- [ ] **Step 2: Record the baseline**

Run: `npx vitest run 2>&1 | tail -3`
Expected: `Tests  2575 passed | 17 skipped (2592)`.

---

### Task 1: Delete fork-era components nothing imports

**Files:**
- Delete: `src/components/shared/ShareButton.tsx`, `src/components/shared/ConfirmDialog.tsx`, `src/components/shared/StarsRating.tsx`, `src/components/shared/SkeletonCard.tsx`, `src/components/shared/EmptyState.tsx`
- Delete: `src/components/chat/ProgressiveText.tsx`, `src/components/chat/__tests__/ProgressiveText.test.tsx`
- Delete: `src/components/papers/PaperResultItem.tsx`, `src/components/papers/__tests__/PaperResultItem.test.tsx`
- Keep: `src/components/shared/GrainOverlay.tsx` (used by `RealFeedCard.tsx`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing — the live equivalents (`src/components/ui/EmptyState.tsx`, `src/components/wiki/DeleteConfirmCard.tsx`, `src/components/papers/ResearchSearchResultItem.tsx`) are untouched.

- [ ] **Step 1: Prove nothing imports them (the "failing test" for a deletion is a non-empty grep)**

Run:
```bash
grep -rn -E "ShareButton|ConfirmDialog|StarsRating|SkeletonCard|shared/EmptyState|ProgressiveText|PaperResultItem\b" src e2e --include='*.ts' --include='*.tsx' | grep -v -E "src/components/shared/(ShareButton|ConfirmDialog|StarsRating|SkeletonCard|EmptyState)\.tsx|ProgressiveText\.(tsx|test\.tsx)|PaperResultItem\.(tsx|test\.tsx)"
```
Expected: no output. (If a line appears, it is a new caller added since the audit — stop and report it instead of deleting.)

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/shared/ShareButton.tsx src/components/shared/ConfirmDialog.tsx src/components/shared/StarsRating.tsx src/components/shared/SkeletonCard.tsx src/components/shared/EmptyState.tsx src/components/chat/ProgressiveText.tsx src/components/chat/__tests__/ProgressiveText.test.tsx src/components/papers/PaperResultItem.tsx src/components/papers/__tests__/PaperResultItem.test.tsx
```

- [ ] **Step 3: Verify types and tests**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: tsc clean; suite green with 2575 − (ProgressiveText cases + PaperResultItem cases) passing — both deleted test files' cases are the only drop.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete fork-era components nothing imports

ShareButton, ConfirmDialog, StarsRating, SkeletonCard, shared/EmptyState,
ProgressiveText and PaperResultItem had zero non-test importers; their live
equivalents are ui/EmptyState, DeleteConfirmCard and ResearchSearchResultItem.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Delete the legacy-prototype warning

**Files:**
- Delete: `src/components/projects/LegacyPrototypeWarning.tsx`, `src/lib/projects/legacy-data.ts`, `src/lib/projects/__tests__/legacy-data.test.ts`
- Modify: `src/components/layout/AppShell.tsx` (import line 15, the `<LegacyPrototypeWarning />` element)
- Modify: `src/components/layout/__tests__/AppShell.test.tsx` (the `vi.mock("@/components/projects/LegacyPrototypeWarning", …)` line)

**Interfaces:**
- Consumes: nothing.
- Produces: `AppShell` no longer renders the warning; nothing else referenced it.

- [ ] **Step 1: Delete the three files**

```bash
git rm src/components/projects/LegacyPrototypeWarning.tsx src/lib/projects/legacy-data.ts src/lib/projects/__tests__/legacy-data.test.ts
```

- [ ] **Step 2: Watch tsc name the two remaining references**

Run: `npx tsc --noEmit`
Expected: errors only in `src/components/layout/AppShell.tsx` (cannot find module `@/components/projects/LegacyPrototypeWarning`).

- [ ] **Step 3: Remove the references**

In `src/components/layout/AppShell.tsx` delete these two lines:

```tsx
import { LegacyPrototypeWarning } from "@/components/projects/LegacyPrototypeWarning";
```
```tsx
      <LegacyPrototypeWarning />
```

In `src/components/layout/__tests__/AppShell.test.tsx` delete:

```tsx
vi.mock("@/components/projects/LegacyPrototypeWarning", () => ({ LegacyPrototypeWarning: () => null }))
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run src/components/layout src/lib/projects 2>&1 | tail -3`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/layout src/components/projects src/lib/projects
git commit -m "chore: drop the fork-prototype localStorage warning

No real user ever ran the mock prototype whose keys it looked for.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Delete RightPanel and the unread ui-store fields

**Files:**
- Delete: `src/components/layout/RightPanel.tsx`
- Modify: `src/stores/ui-store.ts` (whole file, content below)
- Modify: `src/components/layout/AppShell.tsx` (RightPanel import, two selectors, the `<RightPanel>` block)
- Modify: `src/components/layout/__tests__/AppShell.test.tsx` (ui-store mock shape, RightPanel mock)

**Interfaces:**
- Consumes: nothing.
- Produces: `useUIStore` keeps exactly `sidebarOpen`, `setSidebarOpen` (MobileNav), `desktopSidebarOpen`, `toggleDesktopSidebar` (AppShell/Sidebar), `settingsModalSection`, `openSettingsModal`, `closeSettingsModal` (SettingsModal, useCompanion, pages). Task 12 relies on `sidebarOpen`/`setSidebarOpen`/`desktopSidebarOpen` keeping these names.

- [ ] **Step 1: Confirm the panel can never open**

Run: `grep -rn "setRightPanel\|toggleSourcesPanel\|setActiveNav\|toggleSidebar\b\|setDesktopSidebarOpen" src --include='*.ts' --include='*.tsx' | grep -v "stores/ui-store.ts"`
Expected: no output (nothing ever sets `rightPanelContent`, so `RightPanel` renders `null` content forever).

- [ ] **Step 2: Replace `src/stores/ui-store.ts` with only the fields that have readers**

```ts
import { create } from "zustand";

interface UIState {
  /** Mobile slide-over sidebar (MobileNav). */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Desktop sidebar expanded (240px) vs collapsed (60px) — AppShell/Sidebar. */
  desktopSidebarOpen: boolean;
  toggleDesktopSidebar: () => void;
  /** Which settings-modal section is open, or null when closed. */
  settingsModalSection: string | null;
  openSettingsModal: (section?: string) => void;
  closeSettingsModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  desktopSidebarOpen: true,
  toggleDesktopSidebar: () => set((s) => ({ desktopSidebarOpen: !s.desktopSidebarOpen })),
  settingsModalSection: null,
  openSettingsModal: (section = "ai") => set({ settingsModalSection: section }),
  closeSettingsModal: () => set({ settingsModalSection: null }),
}));
```

- [ ] **Step 3: Delete RightPanel and its wiring**

```bash
git rm src/components/layout/RightPanel.tsx
```

In `src/components/layout/AppShell.tsx` delete:

```tsx
import { RightPanel } from "./RightPanel";
```
```tsx
  const showRightPanel = useUIStore((s) => s.showRightPanel);
  const rightPanelContent = useUIStore((s) => s.rightPanelContent);
```
```tsx
        <RightPanel show={showRightPanel}>
          {rightPanelContent}
        </RightPanel>
```

In `src/components/layout/__tests__/AppShell.test.tsx` change the ui-store mock to the surviving shape and drop the RightPanel mock:

```tsx
vi.mock("@/stores/ui-store", () => ({ useUIStore: (select: (state: object) => unknown) => select({ desktopSidebarOpen: true }) }))
```
and delete:
```tsx
vi.mock("../RightPanel", () => ({ RightPanel: () => null }))
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run src/components src/app 2>&1 | tail -3`
Expected: green (`SettingsModal.test`, `useCompanion.test`, `papers/page.test`, `trending-page.test` all use only the surviving fields).

- [ ] **Step 5: Commit**

```bash
git add -A src/stores src/components/layout
git commit -m "chore: remove RightPanel and the ui-store fields nothing reads

setRightPanel had no callers, so the panel's content was always null and it
could never open. Drops the sources-panel/activeNav/toggleSidebar leftovers
from the fork with it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Delete the orphaned search-intent feature, the unused research-search client, and `/library`

**Files:**
- Delete: `src/lib/skills/search-intent.ts`, `src/lib/skills/search-intent-client.ts`, `src/app/api/skills/search-intent/route.ts` (and its now-empty directory)
- Delete tests: `src/lib/skills/__tests__/search-intent.test.ts`, `src/lib/skills/__tests__/search-intent-client.test.ts`, `src/lib/skills/__tests__/live-search-intent.test.ts`, `src/lib/server/__tests__/search-intent-api.test.ts`
- Delete: `src/lib/skills/research-search-client.ts`, `src/lib/skills/__tests__/research-search-client.test.ts`
- Delete: `src/app/library/page.tsx`
- Modify: `src/lib/__tests__/browser-purity.test.ts` (two `CLIENT_LIB_FILES` entries), `src/lib/skills/enrich-client.ts:10` (comment)

**Interfaces:**
- Consumes: nothing.
- Produces: the `/api/search/[source]?sort=` parameter and `search-core.ts`'s `sort` handling stay — `research-search.ts` (the live planner) passes `sort: plan.sort` through them. Only the standalone classifier is gone.

- [ ] **Step 1: Prove the client and the classifier have no production caller**

Run:
```bash
grep -rn "search-intent\|classifySearchIntentRemote\|researchSearchRemote\|\"/library\"" src e2e --include='*.ts' --include='*.tsx' | grep -v -E "__tests__|search-intent-client\.ts|skills/search-intent\.ts|api/skills/search-intent/|research-search-client\.ts|app/library/page\.tsx"
```
Expected: exactly one line — `src/lib/skills/enrich-client.ts:10` (a comment). Anything else is a new caller: stop and report.

- [ ] **Step 2: Delete**

```bash
git rm src/lib/skills/search-intent.ts src/lib/skills/search-intent-client.ts src/app/api/skills/search-intent/route.ts \
  src/lib/skills/__tests__/search-intent.test.ts src/lib/skills/__tests__/search-intent-client.test.ts \
  src/lib/skills/__tests__/live-search-intent.test.ts src/lib/server/__tests__/search-intent-api.test.ts \
  src/lib/skills/research-search-client.ts src/lib/skills/__tests__/research-search-client.test.ts \
  src/app/library/page.tsx
rmdir src/app/api/skills/search-intent src/app/library 2>/dev/null || true
```

- [ ] **Step 3: Update the purity-gate list and the stale comment**

In `src/lib/__tests__/browser-purity.test.ts` delete these two entries from `CLIENT_LIB_FILES`:

```ts
  join("src", "lib", "skills", "search-intent-client.ts"),
  join("src", "lib", "skills", "research-search-client.ts"),
```

In `src/lib/skills/enrich-client.ts` line 10 change `matching \`search-intent-client.ts\`` to `matching \`feed-client.ts\``.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: green; skipped count drops by 1 (the env-gated live gate) and passed drops by the deleted unit cases.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "chore: retire the standalone search-intent skill and unused clients

/papers stopped calling classifySearchIntentRemote in SP2; the research-search
planner already emits sort=relevance|date, so intent extraction still happens
before search. Also drops the never-called researchSearchRemote client and the
unlinked /library redirect.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Delete the dead rank/re-rank skills in `feed.ts`

**Files:**
- Modify: `src/lib/skills/feed.ts:228-355` (the "Rank skill" and "Re-rank skill" sections), line 2 import, `normalizeFeedList` key union, the orchestrator header comment

**Interfaces:**
- Consumes: nothing.
- Produces: `feedStrategySkill`, `runFeed`, `FeedStage` (still `"strategy" | "retrieval" | "rank" | "rerank"` — wire-compatible progress names), `FeedItem`, `FeedResult` unchanged.

- [ ] **Step 1: Prove the two skills are unreferenced**

Run: `grep -rn "feedRankSkill\|feedRerankSkill\|RankSchema\|RerankSchema" src --include='*.ts' --include='*.tsx' | grep -v "src/lib/skills/feed.ts"`
Expected: no output.

- [ ] **Step 2: Delete the block**

In `src/lib/skills/feed.ts` delete everything from the comment line
```ts
// ---------------------------------------------------------------------------
// Rank skill: a `fast`-tier structured call that scores a batch of candidates
```
(line 228) through the closing `})` of `feedRerankSkill` and the blank line after it (line 355) — i.e. `RankScoreSchema`, `RankSchema`, `buildRankSystemPrompt`, `feedRankSkill`, the orphaned "Fixed why-badge vocabulary" doc comment, `RerankItemsSchema`, `RerankSchema`, `buildRerankSystemPrompt`, `feedRerankSkill`. The next surviving line is the `// ----` header above `// Orchestrator: strategy -> retrieve -> rank (batched) -> re-rank -> cached`.

- [ ] **Step 3: Tidy what the deletion orphaned**

Line 2: remove `FEED_BADGE_VALUES` from the *import* (keep line 3's re-export untouched):

```ts
import { FEED_CACHE_PATH, StrategySchema, type FeedStrategy, type FeedBadge } from "./feed-cache"
```

`normalizeFeedList` (≈ line 84): narrow the key union, since only the strategy call uses it now:

```ts
function normalizeFeedList(key: "queries", candidate: unknown): unknown {
```

Orchestrator header comment: replace `strategy -> retrieve -> rank (batched) -> re-rank -> cached` with `strategy -> retrieve -> assessment (batched, recommendationAssessmentSkill) -> deterministic selection -> cached`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/lib/skills src/lib/recommendation src/app/api/skills/feed 2>&1 | tail -3`
Expected: tsc clean, lint 0 errors (no unused import), feed tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/skills/feed.ts
git commit -m "chore(feed): delete the superseded rank/re-rank skills

runFeed moved to recommendationAssessmentSkill + deterministic selection; the
rank/rerank stage names stay for wire-compatible progress only.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Delete small exports with no production caller

**Files:**
- Modify: `src/lib/recommendation/engine.ts:90-111` (`learnTopicAdjustments`), `src/lib/recommendation/__tests__/engine.test.ts` (import line 3 + the `it("requires two independent papers, never counts repeated clicks, and caps influence", …)` case)
- Modify: `src/lib/recommendation/preference-effects.ts:7-10` (`feedbackDecay`)
- Modify: `src/lib/spark/pattern-cards.ts:107-115` (`cardsByIds`), `src/lib/spark/__tests__/pattern-cards.test.ts` (import line 4 + `describe("cardsByIds", …)` block at line 70)
- Modify: `src/lib/highlights/store.ts:115-120` (`updateHighlight`), `src/lib/highlights/__tests__/store.test.ts` (import at line 12 + `describe("updateHighlight", …)` block at line 128)
- Modify: `src/lib/trending/client.ts:45-47` (`autoRefreshTrending`)
- Modify: `src/lib/usermodel/profile-client.ts:26-29` (`createUserProfileRemote`)
- Modify: `src/lib/trending/anchors.ts` (`MAX_ANCHOR_LABEL_LENGTH`), `src/lib/trending/openalex-fields.ts` (`OPENALEX_FIELD_CATALOG_DATE`), `src/lib/trending/openalex-subfields.ts` (`OPENALEX_SUBFIELD_CATALOG_DATE`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing; every other export in these files is untouched.

- [ ] **Step 1: Prove each is unreferenced outside its own file and its own test**

Run:
```bash
for s in learnTopicAdjustments feedbackDecay cardsByIds updateHighlight autoRefreshTrending createUserProfileRemote MAX_ANCHOR_LABEL_LENGTH OPENALEX_FIELD_CATALOG_DATE OPENALEX_SUBFIELD_CATALOG_DATE; do echo "== $s"; grep -rln "$s" src e2e --include='*.ts' --include='*.tsx'; done
```
Expected per symbol: only its defining file, plus (for the first four) the one test file named above, plus `src/app/__tests__/home-paid-gate.test.ts` for `autoRefreshTrending` (that test asserts the home page source does NOT contain the name — it stays green after deletion).

- [ ] **Step 2: Delete the functions and constants**

Remove each `export function …` / `export const …` declaration listed in **Files** (the whole function body through its closing brace). For the two `*_CATALOG_DATE` constants, keep the provenance as a comment in place of the export, e.g. `// Catalog captured from OpenAlex on <the date that was in the constant>.`

- [ ] **Step 3: Delete the four isolated test cases**

- `engine.test.ts`: remove `learnTopicAdjustments` from the import on line 3 and delete the `it("requires two independent papers, never counts repeated clicks, and caps influence", …)` block.
- `pattern-cards.test.ts`: remove `cardsByIds` from the import on line 4 and delete the `describe("cardsByIds", …)` block.
- `store.test.ts` (highlights): remove `updateHighlight` from the import list and delete the `describe("updateHighlight", …)` block.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run src/lib/recommendation src/lib/spark src/lib/highlights src/lib/trending src/lib/usermodel src/app/__tests__ 2>&1 | tail -3`
Expected: green; lint 0 errors (no unused constants left behind, e.g. a `MIN_LIMIT`-style helper only the deleted function used — if lint flags one, delete it too).

- [ ] **Step 5: Commit**

```bash
git add -A src/lib
git commit -m "chore: delete exports with no production caller

learnTopicAdjustments, feedbackDecay, cardsByIds, updateHighlight,
autoRefreshTrending, createUserProfileRemote and three unread constants.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Shrink `get-vault.ts` to the one path that runs

**Files:**
- Modify: `src/lib/vault/get-vault.ts` (whole file, content below)
- Modify: `src/app/debug/vault/page.tsx` (`getVault` → `getOpenVault`)
- Delete: `src/lib/vault/__tests__/get-vault.test.ts` (it only tests the Memory fallback and the retry memo, neither of which survives)

**Interfaces:**
- Consumes: `RemoteVaultStorage` from `src/lib/vault/remote-storage.ts`.
- Produces: `getOpenVault(): Promise<VaultStorage>` — same name and signature the six client pages already call (`/`, `/reader`, `/paper/[key]`, `/papers`, `/wiki`, and now `/debug/vault`). `getVault` is removed.

- [ ] **Step 1: Prove every caller is a client page**

Run: `grep -rln "vault/get-vault" src --include='*.ts' --include='*.tsx' | grep -v __tests__ | xargs grep -L '"use client"'`
Expected: no output (every importer is a `"use client"` module, so the `typeof window === "undefined"` Memory branch never runs in the app).

- [ ] **Step 2: Replace `src/lib/vault/get-vault.ts`**

```ts
import type { VaultStorage } from "./storage"
import { RemoteVaultStorage } from "./remote-storage"

let vault: VaultStorage | null = null

/** Browser-side vault handle. Every read/write proxies to /api/vault/* — the
 * server owns the on-disk vault and its scaffolding, so there is nothing to
 * open or retry here. */
export function getOpenVault(): Promise<VaultStorage> {
  vault ??= new RemoteVaultStorage()
  return Promise.resolve(vault)
}
```

- [ ] **Step 3: Point the debug page at the surviving export and delete the old test**

In `src/app/debug/vault/page.tsx` change `import { getVault } from "@/lib/vault/get-vault"` to `import { getOpenVault } from "@/lib/vault/get-vault"` and `const vault = await getVault()` to `const vault = await getOpenVault()`.

```bash
git rm src/lib/vault/__tests__/get-vault.test.ts
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run src/lib/vault src/app 2>&1 | tail -3`
Expected: green (every page test mocks `@/lib/vault/get-vault` with `{ getOpenVault }`, so none depends on the deleted branch).

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/vault src/app/debug/vault
git commit -m "chore(vault): drop the never-run Memory fallback from getOpenVault

All callers are client pages; the browser vault is always RemoteVaultStorage,
which cannot reject on construction, so the retry memo protected nothing.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Replace the 12 hand-rolled `jsonResponse` helpers with `Response.json`

**Files:**
- Modify (delete the local `function jsonResponse` and rewrite its calls): `src/app/api/settings/route.ts`, `src/app/api/usage/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/history/changes/[changesetId]/route.ts`, `src/app/api/history/changes/route.ts`, `src/app/api/skills/digest/route.ts`, `src/app/api/vault/changeset/route.ts`, `src/app/api/vault/file/route.ts`, `src/app/api/vault/list/route.ts`, `src/lib/server/skill-route.ts`, `src/lib/server/fetch-relay.ts`
- Modify: `src/lib/projects/server-api.ts` (delete the *exported* `jsonResponse`) and its five importers `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/members/route.ts`, `src/app/api/projects/[id]/notes/route.ts`, `src/app/api/projects/[id]/notes/[noteId]/route.ts`

**Interfaces:**
- Consumes: the platform `Response.json(body, init)` (already used at 45 sites in `src/app`).
- Produces: identical wire responses — `Response.json` sets `content-type: application/json` exactly as the helpers did.

- [ ] **Step 1: Rewrite each call site**

Mechanical rule, applied by hand in every file above (the two-argument helpers):

```ts
jsonResponse(STATUS, BODY)      →   Response.json(BODY, { status: STATUS })
```

`src/lib/server/fetch-relay.ts` has the three-argument variant:

```ts
jsonResponse(STATUS, BODY, HEADERS)   →   Response.json(BODY, { status: STATUS, headers: HEADERS })
jsonResponse(STATUS, BODY)            →   Response.json(BODY, { status: STATUS })
```

Then delete the `function jsonResponse(...) { ... }` definition in each file, and in the five project routes replace `import { jsonResponse, ... } from "@/lib/projects/server-api"` with the same import minus `jsonResponse` (delete the import line entirely if `jsonResponse` was its only binding).

- [ ] **Step 2: Prove none is left**

Run: `grep -rn "jsonResponse" src --include='*.ts' --include='*.tsx' | grep -v __tests__`
Expected: no output. (The `jsonResponse` helpers inside `src/lib/companion/__tests__/settings-client.test.ts` and `src/lib/trending/__tests__/settings-client.test.ts` are test fixtures and stay.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run src/lib/server src/app/api src/lib/projects 2>&1 | tail -3`
Expected: green — the route tests assert status codes and JSON bodies, which are unchanged.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/api src/lib/server src/lib/projects
git commit -m "chore(api): use Response.json instead of 12 local jsonResponse helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: One `readErrorMessage`, one settings-file reader, one refresh-failure reader

**Files:**
- Create: `src/lib/http.ts`, `src/lib/__tests__/http.test.ts`
- Modify (delete the local copy, import instead): `src/lib/chat/save-query-client.ts`, `src/lib/companion/client.ts`, `src/lib/lint/client.ts`, `src/lib/reader/client.ts`, `src/lib/skills/ingest-client.ts`, `src/lib/spark/client.ts`, `src/lib/vault/changeset-client.ts`
- Modify: `src/lib/__tests__/browser-purity.test.ts` (add `http.ts` to `CLIENT_LIB_FILES`)
- Modify: `src/lib/vault/settings-write.ts` (export `readSettingsFile`), `src/lib/llm/settings.ts`, `src/lib/companion/settings.ts`, `src/lib/trending/settings.ts` (delete `readJsonFile`)
- Modify: `src/lib/trending/auto-refresh.ts` (export `readRefreshFailureReason`), `src/app/api/skills/trending/auto-refresh/route.ts`, `src/lib/scheduler/heartbeat.ts` (delete `readFailureReason`)

**Interfaces:**
- Produces: `readErrorMessage(res: Response, fallback: string): Promise<string>` in `src/lib/http.ts`; `readSettingsFile(storage: VaultStorage): Promise<Record<string, unknown>>` in `src/lib/vault/settings-write.ts`; `readRefreshFailureReason(storage: VaultStorage): Promise<string | undefined>` in `src/lib/trending/auto-refresh.ts`.

- [ ] **Step 1: Write the failing test for the shared client helper**

`src/lib/__tests__/http.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readErrorMessage } from "../http"

describe("readErrorMessage", () => {
  it("returns the body's error field", async () => {
    expect(await readErrorMessage(Response.json({ error: "boom" }, { status: 500 }), "fallback")).toBe("boom")
  })

  it("falls back when the body has no error field or is not JSON", async () => {
    expect(await readErrorMessage(Response.json({}, { status: 500 }), "fallback")).toBe("fallback")
    expect(await readErrorMessage(new Response("<html>", { status: 502 }), "fallback")).toBe("fallback")
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/__tests__/http.test.ts`
Expected: FAIL — cannot resolve `../http`.

- [ ] **Step 3: Create `src/lib/http.ts`**

```ts
/** Error text from a JSON `{ error }` API body, else `fallback`. Never throws. */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? fallback
  } catch {
    return fallback
  }
}
```

- [ ] **Step 4: Run the test to see it pass, then switch the seven callers**

Run: `npx vitest run src/lib/__tests__/http.test.ts` → PASS.

In each of the seven client files delete the local `async function readErrorMessage(...) { ... }` (they are byte-identical) and add `import { readErrorMessage } from "../http"` (every one of them lives one directory below `src/lib`, so the relative path is the same). Add `join("src", "lib", "http.ts"),` to `CLIENT_LIB_FILES` in `src/lib/__tests__/browser-purity.test.ts`.

- [ ] **Step 5: Export the settings-file reader and delete the three copies**

In `src/lib/vault/settings-write.ts` rename the private `readFile` to an export (the body is unchanged):

```ts
/** Parsed .scispark/settings.json, or {} when missing/unparseable. */
export async function readSettingsFile(storage: VaultStorage): Promise<Record<string, unknown>> {
```
and update its one internal call (`const file = await readSettingsFile(storage)`).

In `src/lib/llm/settings.ts`, `src/lib/companion/settings.ts`, `src/lib/trending/settings.ts`: delete the local `async function readJsonFile(...)`, extend the existing import `import { withSettingsWrite } from "../vault/settings-write"` to `import { withSettingsWrite, readSettingsFile } from "../vault/settings-write"`, and replace every `readJsonFile(storage)` with `readSettingsFile(storage)`. If `npm run lint` then reports a file's local `SETTINGS_PATH` as unused, delete that constant too (it was only feeding the deleted reader).

- [ ] **Step 6: Export the refresh-failure reader and delete the two copies**

In `src/lib/trending/auto-refresh.ts` (which already owns `REFRESH_FAILURE_PATH`) add:

```ts
/** Best-effort `lastError` from the refresh failure marker, for ledger/UI reasons. */
export async function readRefreshFailureReason(storage: VaultStorage): Promise<string | undefined> {
  try {
    const raw = await storage.read(REFRESH_FAILURE_PATH)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw) as { lastError?: unknown }
    return typeof parsed.lastError === "string" ? parsed.lastError : undefined
  } catch {
    return undefined
  }
}
```
(add `import type { VaultStorage } from "../vault/storage"` if the file lacks it). In `src/app/api/skills/trending/auto-refresh/route.ts` and `src/lib/scheduler/heartbeat.ts` delete the local `readFailureReason`, import `readRefreshFailureReason` from the auto-refresh module (they already import `REFRESH_FAILURE_PATH`/`maybeAutoRefreshTrending` from it), and rename the call sites. Remove `REFRESH_FAILURE_PATH` from those imports if it is now unused.

- [ ] **Step 7: Verify**

Run: `grep -rn "async function readErrorMessage\|async function readJsonFile\|async function readFailureReason" src | grep -v __tests__` → no output.
Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green, +2 tests.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib src/app/api/skills/trending
git commit -m "refactor: share readErrorMessage, readSettingsFile and readRefreshFailureReason

Seven, three and two byte-identical private copies respectively.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: One `tokenize`/`truncateAtWhitespace`, one `asStringArray`, one `clampLimit`

**Files:**
- Create: `src/lib/text.ts`, `src/lib/__tests__/text.test.ts`
- Modify: `src/lib/reader/ask-context.ts`, `src/lib/spark/grounding.ts`, `src/lib/spark/quick.ts` (delete local `tokenize`, `MIN_TOKEN_LENGTH`, `asStringArray`)
- Modify: `src/lib/skills/digest.ts`, `src/lib/skills/ingest-analysis.ts` (delete local `truncateAtWhitespace`)
- Modify: `src/lib/vault/frontmatter.ts` (export `asStringArray`)
- Modify: `src/lib/papers/types.ts` (export `clampLimit` + bounds), `src/lib/papers/arxiv.ts`, `src/lib/papers/openalex.ts`, `src/lib/papers/pubmed.ts`, `src/lib/papers/s2.ts` (delete local copies)

**Interfaces:**
- Produces: `tokenize(text: string, minLength = 4): Set<string>` and `truncateAtWhitespace(text: string, limit: number): string` in `src/lib/text.ts`; `asStringArray(value: unknown): string[]` in `src/lib/vault/frontmatter.ts`; `clampLimit(limit: number | undefined): number` plus `MIN_LIMIT = 1`, `MAX_LIMIT = 50`, `DEFAULT_LIMIT = 20` in `src/lib/papers/types.ts`.

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/text.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { tokenize, truncateAtWhitespace } from "../text"

describe("tokenize", () => {
  it("lower-cases, splits on non-alphanumerics and drops short tokens", () => {
    expect([...tokenize("EEG-based Auditory attention, 2024!")]).toEqual(["based", "auditory", "attention", "2024"])
  })
  it("honors a custom minimum length", () => {
    expect([...tokenize("a bb ccc", 2)]).toEqual(["bb", "ccc"])
  })
})

describe("truncateAtWhitespace", () => {
  it("returns short text unchanged", () => {
    expect(truncateAtWhitespace("short", 10)).toBe("short")
  })
  it("cuts back to the last whitespace before the limit", () => {
    expect(truncateAtWhitespace("alpha beta gamma", 12)).toBe("alpha beta")
  })
  it("hard-cuts when no whitespace lies within 200 chars of the limit", () => {
    expect(truncateAtWhitespace("x".repeat(300), 250)).toBe("x".repeat(250))
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/__tests__/text.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `src/lib/text.ts`**

```ts
/** Lower-cased alphanumeric tokens of at least `minLength` chars, for term-overlap scoring. */
export function tokenize(text: string, minLength = 4): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= minLength))
}

/** Cuts `text` to at most `limit` chars, backing up to the last whitespace within 200 chars of the cut. */
export function truncateAtWhitespace(text: string, limit: number): string {
  if (text.length <= limit) return text
  const hardCut = text.slice(0, limit)
  const searchFloor = Math.max(0, hardCut.length - 200)
  for (let i = hardCut.length - 1; i >= searchFloor; i--) {
    if (/\s/.test(hardCut[i])) return hardCut.slice(0, i)
  }
  return hardCut
}
```

- [ ] **Step 4: Run the test to see it pass, then switch the callers**

Run: `npx vitest run src/lib/__tests__/text.test.ts` → PASS.

- `src/lib/reader/ask-context.ts`, `src/lib/spark/grounding.ts`, `src/lib/spark/quick.ts`: delete the local `function tokenize`, the `const MIN_TOKEN_LENGTH = 4` (all three use 4, the new default), and the local `function asStringArray`; add `import { tokenize } from "../text"` and `import { asStringArray } from "../vault/frontmatter"`. Call sites keep the same shape (`tokenize(text)`, `asStringArray(value)`).
- `src/lib/skills/digest.ts`, `src/lib/skills/ingest-analysis.ts`: delete the local `function truncateAtWhitespace` (identical bodies) and add `import { truncateAtWhitespace } from "../text"`.

- [ ] **Step 5: Export `asStringArray` from `src/lib/vault/frontmatter.ts`**

Append:

```ts
/** The string members of a frontmatter list value; anything else reads as empty. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}
```
(`src/lib/skills/ingest.ts` keeps its own `string[] | undefined` variant — different contract, not a copy.)

- [ ] **Step 6: Export `clampLimit` from `src/lib/papers/types.ts` and delete the four copies**

Append to `src/lib/papers/types.ts`:

```ts
export const MIN_LIMIT = 1
export const MAX_LIMIT = 50
export const DEFAULT_LIMIT = 20

/** Result-count bound every source adapter applies before building its request URL. */
export function clampLimit(limit: number | undefined): number {
  if (limit == null || Number.isNaN(limit)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)))
}
```

In `arxiv.ts`, `openalex.ts`, `pubmed.ts`, `s2.ts`: delete the local `MIN_LIMIT`/`MAX_LIMIT`/`DEFAULT_LIMIT` consts and `function clampLimit`, and add `clampLimit` (plus any of the three constants the file still references elsewhere — check with `grep -n "_LIMIT" <file>`) to the file's existing `import ... from "./types"`.

- [ ] **Step 7: Verify**

Run: `grep -rn "^function tokenize\|^function asStringArray\|^function clampLimit\|^function truncateAtWhitespace\|MIN_TOKEN_LENGTH" src | grep -v __tests__` → only `src/lib/skills/ingest.ts`'s `asStringArray` may remain.
Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green, +5 tests.

- [ ] **Step 8: Commit**

```bash
git add -A src/lib
git commit -m "refactor: one tokenize/truncateAtWhitespace/asStringArray/clampLimit

Replaces 3+2+3+4 byte-identical private copies.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: One loose-JSON parser, inlined date strings, one `slugOf`, `NavStore` as a `Pick`

**Files:**
- Create: `src/lib/llm/json.ts`, `src/lib/llm/__tests__/json.test.ts`
- Modify: `src/lib/llm/providers/openai-compat.ts` (delete `safeParse` + `jsonCandidates`), `src/lib/llm/providers/google.ts`, `src/lib/llm/providers/anthropic.ts` (delete `safeParse`)
- Modify: `src/lib/llm/metering.ts`, `src/lib/llm/usage-summary.ts` (`utcDateString`), `src/app/wiki/page.tsx`, `src/app/wiki/[...id]/page.tsx` (`today`)
- Modify: `src/lib/wiki/href.ts` (export `slugOf`), `src/lib/lint/checks.ts`, `src/lib/wiki/dashboard.ts` (delete local `slugOf`)
- Modify: `src/lib/ui/nav-history.ts:25-28` (`NavStore`)

**Interfaces:**
- Produces: `parseJsonLoosely(text: string): unknown` in `src/lib/llm/json.ts` (Task 13's Anthropic rewrite imports it); `slugOf(id: string): string` in `src/lib/wiki/href.ts`; `NavStore` stays exported as a type alias with the same shape.

- [ ] **Step 1: Write the failing test**

`src/lib/llm/__tests__/json.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { parseJsonLoosely } from "../json"

describe("parseJsonLoosely", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 })
  })
  it("parses a fenced block and JSON wrapped in prose", () => {
    expect(parseJsonLoosely('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonLoosely('Here you go: [1,2] thanks')).toEqual([1, 2])
  })
  it("returns undefined when nothing parses", () => {
    expect(parseJsonLoosely("not json")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/llm/__tests__/json.test.ts` → FAIL (module not found).

- [ ] **Step 3: Create `src/lib/llm/json.ts` (moved verbatim from openai-compat.ts)**

```ts
/** Best-effort JSON from a model reply: the raw text, then a ```json fence, then
 * the outermost {...} / [...]. Prompt-embedded JSON fallbacks wrap output in
 * fences or prose despite instructions; zod re-validation stays the enforcement layer. */
export function parseJsonLoosely(text: string): unknown {
  for (const candidate of jsonCandidates(text)) {
    try { return JSON.parse(candidate) } catch { /* try next */ }
  }
  return undefined
}

function jsonCandidates(text: string): string[] {
  const out: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out.push(fenced[1].trim())
  const objStart = text.indexOf("{")
  const objEnd = text.lastIndexOf("}")
  if (objStart >= 0 && objEnd > objStart) out.push(text.slice(objStart, objEnd + 1))
  const arrStart = text.indexOf("[")
  const arrEnd = text.lastIndexOf("]")
  if (arrStart >= 0 && arrEnd > arrStart) out.push(text.slice(arrStart, arrEnd + 1))
  return out
}
```

- [ ] **Step 4: Run the test to see it pass, then switch the three providers**

Run: `npx vitest run src/lib/llm/__tests__/json.test.ts` → PASS.

- `openai-compat.ts`: delete `function safeParse` and `function jsonCandidates` (and the comment block above them), add `import { parseJsonLoosely } from "../json"`, replace `safeParse(text)` with `parseJsonLoosely(text)`.
- `google.ts` and `anthropic.ts`: delete the local `function safeParse` (the strict `JSON.parse`-or-undefined one), import `parseJsonLoosely` from `"../json"`, replace the call. This makes them tolerant of fenced JSON too — strictly more lenient, and every structured result is still zod-validated in `completeStructured`.

- [ ] **Step 5: Inline the four date helpers**

- `src/lib/llm/metering.ts`: delete `function utcDateString(d: Date): string { ... }`; replace its three calls `utcDateString(X)` with `X.toISOString().slice(0, 10)`.
- `src/lib/llm/usage-summary.ts`: same for its three calls; also delete the comment `// Mirrors metering.ts's utcDateString exactly so day-bucketing here matches …` (there is nothing to mirror now — keep any sentence in it that explains UTC bucketing).
- `src/app/wiki/page.tsx` and `src/app/wiki/[...id]/page.tsx`: delete `function today(): string { ... }`; replace `today()` with `new Date().toISOString().slice(0, 10)`.

- [ ] **Step 6: One `slugOf`**

Append to `src/lib/wiki/href.ts`:

```ts
/** Last path segment of a page id (`wiki/concepts/foo` → `foo`). */
export function slugOf(id: string): string {
  return id.split("/").pop() ?? id
}
```
Delete the local `function slugOf` in `src/lib/lint/checks.ts` (line ≈321) and `src/lib/wiki/dashboard.ts` (line ≈70) and import it from `"../wiki/href"` / `"./href"` respectively.

- [ ] **Step 7: `NavStore` as a `Pick`**

In `src/lib/ui/nav-history.ts` replace

```ts
/** Minimal surface of sessionStorage this module needs, so tests can pass a fake. */
export interface NavStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
```
with
```ts
/** Minimal surface of sessionStorage this module needs, so tests can pass a fake. */
export type NavStore = Pick<Storage, "getItem" | "setItem">
```
(`src/lib/ui/__tests__/nav-history.test.ts` passes an object with exactly those two methods — structurally identical.)

- [ ] **Step 8: Verify**

Run: `grep -rn "^function safeParse\|^function jsonCandidates\|^function utcDateString\|^function today\|^function slugOf" src | grep -v __tests__` → no output.
Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green, +3 tests.

- [ ] **Step 9: Commit**

```bash
git add -A src/lib src/app/wiki
git commit -m "refactor: share parseJsonLoosely and slugOf; inline date-string and NavStore boilerplate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Native `AbortSignal.timeout` / `AbortSignal.any` instead of hand-rolled deadlines

**Files:**
- Delete: `src/lib/papers/fetch-timeout.ts`, `src/lib/papers/__tests__/fetch-timeout.test.ts`
- Modify: `src/lib/papers/types.ts` (export `SOURCE_FETCH_TIMEOUT_MS`), `src/lib/papers/arxiv.ts:2,284`, `src/lib/papers/openalex.ts:1,328`
- Modify: `src/lib/papers/source-requests.ts` (`withSourceDeadline`)

**Interfaces:**
- Produces: `SOURCE_FETCH_TIMEOUT_MS = 15_000` in `src/lib/papers/types.ts`. `withSourceDeadline(parent, task, timeoutMs = 20_000)` keeps its signature; timeout still rejects with a `DOMException` named `TimeoutError`, parent aborts still propagate the parent's reason (`AbortError`) — the existing `source-requests.test.ts` cases at lines 91/116/131 assert exactly that.

- [ ] **Step 1: Run the existing deadline tests as the guard**

Run: `npx vitest run src/lib/papers/__tests__/source-requests.test.ts src/lib/papers/__tests__/arxiv*.test.ts src/lib/papers/__tests__/openalex*.test.ts 2>&1 | tail -3`
Expected: green (this is the contract the rewrite must keep).

- [ ] **Step 2: Replace the adapter timeout wrapper**

Append to `src/lib/papers/types.ts`:

```ts
/** Per-request ceiling for source adapters (connection + headers + body). */
export const SOURCE_FETCH_TIMEOUT_MS = 15_000
```

In `src/lib/papers/arxiv.ts` delete `import { fetchWithTimeout } from "./fetch-timeout"`, add `SOURCE_FETCH_TIMEOUT_MS` to the `./types` import, and change line 284 to:

```ts
      response = await fetchFn(url, { signal: AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS) })
```
Same edit in `src/lib/papers/openalex.ts` (line 328). Then:

```bash
git rm src/lib/papers/fetch-timeout.ts src/lib/papers/__tests__/fetch-timeout.test.ts
```

- [ ] **Step 3: Rewrite `withSourceDeadline` in `src/lib/papers/source-requests.ts`**

Replace the whole function with:

```ts
/** Bound a whole logical search, including queue wait, retries and body parsing.
 * A feed deadline can abort the same work sooner; no delayed ghost searches. */
export async function withSourceDeadline<T>(
  parent: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>, timeoutMs = 20_000,
): Promise<T> {
  const signal = AbortSignal.any([...(parent ? [parent] : []), AbortSignal.timeout(timeoutMs)])
  signal.throwIfAborted()
  return abortable(task(signal), signal)
}
```
(`abortable` and everything else in the file stays. `AbortSignal.timeout`'s reason is a `TimeoutError` DOMException; `AbortSignal.any` forwards the parent's reason unchanged.)

- [ ] **Step 4: Verify**

Run: `grep -rn "fetchWithTimeout\|fetch-timeout" src` → no output.
Run: `npx tsc --noEmit && npx vitest run src/lib/papers src/lib/skills src/lib/recommendation 2>&1 | tail -3` → green; the deleted `fetch-timeout.test.ts` cases are the only drop.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/papers
git commit -m "refactor(papers): use AbortSignal.timeout/any for request deadlines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Replace `framer-motion` with CSS transitions

**Files:**
- Modify: `src/components/layout/AppShell.tsx` (sidebar width), `src/components/layout/MobileNav.tsx` (overlay + drawer), `src/components/companion/CompanionBubble.tsx`, `src/components/notes/SelectionToNoteBubble.tsx`
- Modify: `src/components/layout/__tests__/AppShell.test.tsx` (delete the `framer-motion` mock)
- Modify: `package.json` / `package-lock.json` via `npm uninstall framer-motion`

**Interfaces:**
- Consumes: `useUIStore` fields `sidebarOpen`/`setSidebarOpen`/`desktopSidebarOpen` (Task 3 kept these names).
- Produces: same DOM markers the e2e specs look for — `[data-companion-bubble]`, `[data-selection-bubble]`, buttons named "Open menu"/"Close menu".

- [ ] **Step 1: AppShell sidebar width → CSS transition**

Delete `import { motion } from "framer-motion";` and replace the `<motion.div …>…</motion.div>` wrapper with:

```tsx
        <div
          className="hidden lg:block h-full flex-shrink-0 overflow-hidden border-r border-border-warm transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{ width: desktopSidebarOpen ? 240 : 60 }}
        >
          <Sidebar collapsed={!desktopSidebarOpen} />
        </div>
```

- [ ] **Step 2: MobileNav drawer → always mounted, class-toggled, `inert` while closed**

Delete `import { motion, AnimatePresence } from "framer-motion";` and replace the whole `<AnimatePresence>…</AnimatePresence>` block with:

```tsx
      {/* Slide-over sidebar: kept mounted so open and close both transition;
          `inert` keeps the closed drawer out of the tab order and screen readers. */}
      <div
        onClick={() => setSidebarOpen(false)}
        className={`lg:hidden fixed inset-0 z-50 bg-espresso/30 backdrop-blur-sm transition-opacity duration-200 ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <div
        inert={!sidebarOpen}
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[240px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="h-full relative">
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-4 right-3 p-1 text-muted-text hover:text-espresso z-10"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
          <Sidebar />
        </div>
      </div>
```

- [ ] **Step 3: CompanionBubble → `starting:` enter fade**

Delete `import { motion, AnimatePresence } from "framer-motion";`. Replace `<AnimatePresence><motion.div key="companion-bubble" data-companion-bubble initial={…} animate={…} exit={…} transition={…} className="…" role="status" aria-busy={streaming}>` … `</motion.div></AnimatePresence>` with a plain div; the inner content is unchanged:

```tsx
    <div
      data-companion-bubble
      className="absolute bottom-full right-0 mb-3 w-64 rounded-card border border-border-warm/60 bg-light-surface p-4 shadow-lg transition-[opacity,transform] duration-150 ease-out starting:translate-y-2 starting:scale-95 starting:opacity-0"
      role="status"
      aria-busy={streaming}
    >
      …unchanged children…
    </div>
```

- [ ] **Step 4: SelectionToNoteBubble → opacity-only enter fade (its inline `transform` centers it, so no transform animation)**

Delete `import { AnimatePresence, motion } from "framer-motion"`. Replace the `<AnimatePresence><motion.div key="bubble" …>` wrapper with:

```tsx
    <div
      data-selection-bubble
      style={{ position: "fixed", top: state.top, left: state.left, transform: "translate(-50%, 0)", zIndex: 70 }}
      className="rounded-pill border border-border-warm/40 bg-light-surface shadow-md transition-opacity duration-150 ease-out starting:opacity-0"
      onMouseDown={(event) => event.stopPropagation()}
    >
      …unchanged children…
    </div>
```

- [ ] **Step 5: Uninstall and drop the test mock**

```bash
npm uninstall framer-motion
```
In `src/components/layout/__tests__/AppShell.test.tsx` delete the `vi.mock("framer-motion", () => ({ … }))` block and the now-unused `ReactNode` import if nothing else uses it.

Run: `grep -rn "framer-motion" src package.json` → no output.

- [ ] **Step 6: Verify in the suite and in the browser**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green.
Run the app (`npm run dev`, or the `.claude/launch.json` preview) at a mobile viewport: tap "Open menu" — the drawer slides in and the overlay fades; tap the overlay — both go away; Tab with the drawer closed must not focus its links. On desktop toggle the sidebar collapse — width animates 240↔60. Trigger a companion bubble (or open `/reader` and select text) — the bubble fades in. Take one screenshot of the open mobile drawer for the task report.

- [ ] **Step 7: Commit**

```bash
git add -A src package.json package-lock.json
git commit -m "chore(ui): replace framer-motion with CSS transitions

Five enter/exit fades become transition classes (Tailwind starting: variant for
enter, class toggles for the mobile drawer). Exit fades on the two bubbles are
now instant. -1 dependency (5.5 MB).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Replace `@anthropic-ai/sdk` with a raw Messages API call

**Files:**
- Modify: `src/lib/llm/providers/anthropic.ts` (whole file, content below)
- Modify: `src/lib/llm/__tests__/anthropic.test.ts` (one new test), `src/lib/llm/__tests__/streaming.test.ts` (test title only)
- Modify: `package.json` / `package-lock.json` via `npm uninstall @anthropic-ai/sdk`

**Interfaces:**
- Consumes: `readSseData` (`src/lib/llm/sse.ts`), `parseJsonLoosely` (Task 11), the `LLM*Error` classes in `src/lib/llm/types.ts`.
- Produces: `new AnthropicProvider(apiKey: string, fetchFn?: typeof fetch)` with the same constructor and `complete(model, req)` contract `buildProvider` (`src/lib/llm/settings.ts:90`) already uses. Same request body (`model`, `max_tokens`, `system`, `messages`, `output_config.format.json_schema`, `stream`), same result mapping, same error mapping as before.

- [ ] **Step 1: Write the failing test (the SDK owned these headers; now we do)**

Append inside the `describe("AnthropicProvider", …)` block of `src/lib/llm/__tests__/anthropic.test.ts`:

```ts
  it("authenticates with x-api-key and pins the API version", async () => {
    const { fn, captured } = fakeFetch(200, OK_MESSAGE)
    await new AnthropicProvider("sk-test", fn).complete("claude-haiku-4-5", { messages: [{ role: "user", content: "hi" }] })
    const headers = captured.init?.headers as Record<string, string>
    expect(headers["x-api-key"]).toBe("sk-test")
    expect(headers["anthropic-version"]).toBe("2023-06-01")
    expect(headers["content-type"]).toBe("application/json")
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/lib/llm/__tests__/anthropic.test.ts`
Expected: the new case FAILS (the SDK sends a `Headers` instance, so the plain-object lookups are `undefined`); the six existing cases pass.

- [ ] **Step 3: Replace `src/lib/llm/providers/anthropic.ts`**

```ts
import type { LLMProvider, LLMRequest, LLMResult, ProviderId } from "../types"
import {
  LLMAuthError, LLMBadRequestError, LLMRateLimitError, LLMRefusalError, LLMTransientError,
} from "../types"
import { readSseData } from "../sse"
import { parseJsonLoosely } from "../json"

const BASE_URL = "https://api.anthropic.com"
const API_VERSION = "2023-06-01"
// Covers connection, headers AND body (the signal aborts a streaming body too).
const TIMEOUT_MS = 120_000

interface MessagesResponse {
  model?: string
  content?: Array<{ type: string; text?: string }>
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

export class AnthropicProvider implements LLMProvider {
  readonly id: ProviderId = "anthropic"

  // BYOK: the user's own key from local settings; retries live in withRetry at the harness layer.
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch) {}

  async complete(model: string, req: LLMRequest): Promise<LLMResult> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n")
    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    const body = {
      model,
      max_tokens: req.maxTokens ?? 8192,
      ...(system ? { system } : {}),
      messages,
      ...(req.jsonSchema ? { output_config: { format: { type: "json_schema", schema: req.jsonSchema } } } : {}),
      ...(req.onText ? { stream: true } : {}),
    }

    req.onText?.("")
    let res: Response
    try {
      res = await this.fetchFn(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (e) {
      throw new LLMTransientError(e instanceof Error ? e.message : "network error")
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      if (res.status === 401 || res.status === 403) throw new LLMAuthError(text || `HTTP ${res.status}`)
      if (res.status === 429) {
        // Header absent → get() is null and Number(null) is 0 — must not become a 0ms hint.
        const raw = res.headers.get("retry-after")
        const ra = raw != null ? Number(raw) : NaN
        throw new LLMRateLimitError(text || "rate limited", Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined)
      }
      if (res.status >= 500) throw new LLMTransientError(text || `HTTP ${res.status}`)
      throw new LLMBadRequestError(text || `HTTP ${res.status}`)
    }

    const data = req.onText ? await readMessageStream(res, req.onText) : (await res.json()) as MessagesResponse
    if (data.stop_reason === "refusal") throw new LLMRefusalError("provider declined the request")
    const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
    return {
      text,
      json: req.jsonSchema ? parseJsonLoosely(text) : undefined,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      model: data.model ?? model,
      provider: this.id,
      stopReason: data.stop_reason ?? "unknown",
    }
  }
}

/** Folds the Messages API event stream into one response, snapshotting the text so far to `onText`. */
async function readMessageStream(res: Response, onText: (text: string) => void): Promise<MessagesResponse> {
  const result: MessagesResponse = { usage: {} }
  let text = ""
  let stopped = false
  for await (const data of readSseData(res)) {
    const event = JSON.parse(data) as {
      type: string
      message?: MessagesResponse
      delta?: { type?: string; text?: string; stop_reason?: string | null }
      usage?: { output_tokens?: number }
      error?: { message?: string }
    }
    if (event.type === "error") throw new LLMTransientError(event.error?.message ?? "Provider stream failed")
    if (event.type === "message_start" && event.message) {
      result.model = event.message.model
      result.usage = { ...event.message.usage }
    } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      text += event.delta.text ?? ""
      onText(text)
    } else if (event.type === "message_delta") {
      if (event.delta?.stop_reason) result.stop_reason = event.delta.stop_reason
      if (event.usage?.output_tokens != null) result.usage = { ...result.usage, output_tokens: event.usage.output_tokens }
    } else if (event.type === "message_stop") {
      stopped = true
    }
  }
  if (!stopped) throw new LLMTransientError("Provider stream interrupted before completion")
  result.content = [{ type: "text", text }]
  return result
}
```

- [ ] **Step 4: Uninstall and run the provider tests**

```bash
npm uninstall @anthropic-ai/sdk
```
In `src/lib/llm/__tests__/streaming.test.ts` rename the case `"streams Anthropic text through the SDK with final usage"` to `"streams Anthropic Messages API text with final usage"` (its fixture — `message_start` with `input_tokens: 10`, two `text_delta`s, `message_delta` with `output_tokens: 5`, `message_stop` — is exactly the contract above).

Run: `grep -rn "@anthropic-ai" src package.json` → no output.
Run: `npx vitest run src/lib/llm 2>&1 | tail -3` → green (7 anthropic cases incl. the new one, the streaming case, `settings.test.ts`'s provider construction).

- [ ] **Step 5: Full verify + one real call**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green, +1 test.
Live check (only if Tong pastes an Anthropic key in chat — never write it to disk or commit it): start the dev server, enter the key in Settings → Connect your AI with provider **Anthropic**, click **Save & test connection** — expect a green result (this exercises the non-streaming path end to end). Otherwise state in the task report that the raw-fetch provider is unit-verified only and needs Tong's live pass.

- [ ] **Step 6: Commit**

```bash
git add -A src package.json package-lock.json
git commit -m "chore(llm): call the Anthropic Messages API with fetch instead of the SDK

Same request/response/error contract as before, using the repo's own SSE
reader like the OpenAI-compatible and Google providers. Adds the 120s request
timeout Google already has. -1 dependency (9.9 MB).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Replace `d3-scale` and `d3-shape` with arithmetic

**Files:**
- Modify: `src/components/settings/spend-chart.ts` (y scale), `src/components/viz/TimelineView.tsx` (`tickYears`, the position scale, `domainPad`), `src/components/viz/CitationFlowView.tsx` (`linkGen`)
- Modify: `package.json` / `package-lock.json` via `npm uninstall d3-scale d3-shape @types/d3-scale @types/d3-shape`

**Interfaces:**
- Produces: `spendBarLayout` returns byte-identical geometry (`spend-chart.test.ts` asserts exact values). `tickYears` returns the same 1/2/5×10ⁿ tick sequence d3's `ticks()` produced. The citation edge path is the same cubic (`M sx,sy C mx,sy mx,ty tx,ty`, `mx` = midpoint) `linkHorizontal` emitted.

- [ ] **Step 1: Run the geometry tests as the guard**

Run: `npx vitest run src/components/settings/__tests__/spend-chart.test.ts src/components/viz/__tests__/TimelineView.test.tsx src/components/viz/__tests__/CitationFlowView.test.tsx 2>&1 | tail -3` → green.

- [ ] **Step 2: spend-chart.ts**

Delete `import { scaleLinear } from "d3-scale"` and replace the body of `spendBarLayout` from `const maxUsd = …` to the end with:

```ts
  // Tallest bar fills `height`; when every day is $0 any positive denominator
  // works (all bars are height 0), so `|| 1` only avoids a divide-by-zero.
  const max = Math.max(0, ...days.map((d) => d.totalUsd ?? 0)) || 1
  return days.map((d, i) => {
    const top = opts.height - ((d.totalUsd ?? 0) / max) * opts.height
    return { x: i * slot, y: top, w, h: opts.height - top, date: d.date, totalUsd: d.totalUsd }
  })
```

- [ ] **Step 3: TimelineView.tsx**

Delete `import { scaleLinear } from "d3-scale"`. Above `tickYears` add d3's tick-step rule, then replace the wide-span branch:

```ts
/** d3's tick-step rule (1/2/5 × 10ⁿ) without the dependency; years only. */
function tickStep(span: number, count: number): number {
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const ratio = raw / power
  return power * (ratio >= Math.sqrt(50) ? 10 : ratio >= Math.sqrt(10) ? 5 : ratio >= Math.sqrt(2) ? 2 : 1)
}

/** Sensible tick years for the axis: every year when the span is narrow,
 * otherwise "nice" steps that land on decades for wide ranges. */
function tickYears(minYear: number, maxYear: number, pxPerYear: number): number[] {
  const span = maxYear - minYear
  if (span <= 0) return [minYear]
  if (span <= 20) {
    const ticks: number[] = []
    for (let y = minYear; y <= maxYear; y++) ticks.push(y)
    return ticks
  }
  const approxTickCount = Math.max(4, Math.min(10, Math.round((span * pxPerYear) / 90)))
  const step = tickStep(span, approxTickCount)
  const ticks: number[] = []
  for (let y = Math.ceil(minYear / step) * step; y <= maxYear; y += step) ticks.push(y)
  return ticks
}
```

Replace the position scale (≈ lines 133–136):

```ts
  const domainPad = 0.5
  const domainMin = timeline.minYear - domainPad
  const domainSpan = timeline.maxYear + domainPad - domainMin
  const scale = (year: number) => ((year - domainMin) / domainSpan) * chartWidth
```
Every existing use is a plain call `scale(year)` — confirm with `grep -n "scale\." src/components/viz/TimelineView.tsx` (expected: no output).

- [ ] **Step 4: CitationFlowView.tsx**

Delete `import { linkHorizontal } from "d3-shape"` and `const linkGen = linkHorizontal()`; add:

```ts
/** Cubic "sankey" link: horizontal tangents at both ends, control points at the midpoint x. */
function linkPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2
  return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`
}
```
and at the edge render replace
```tsx
                    const d = linkGen({ source: [s.x, s.y], target: [t.x, t.y] })
                    if (!d) return null
```
with
```tsx
                    const d = linkPath(s.x, s.y, t.x, t.y)
```
Update the doc comment that says ``cubic curves via `d3-shape`'s `linkHorizontal` `` to ``cubic curves (`linkPath`)``.

- [ ] **Step 5: Uninstall and verify**

```bash
npm uninstall d3-scale d3-shape @types/d3-scale @types/d3-shape
```
Run: `grep -rn "d3-scale\|d3-shape" src package.json` → no output; `ls node_modules | grep -E "^d3-"` → exactly `d3-dispatch`, `d3-force`, `d3-quadtree`, `d3-timer` (the transitive `d3-array/format/interpolate/time/time-format/color/path` packages are gone with the two direct deps).
Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3` → green.
Open `/viz` → Timeline and Citations lenses and `/settings` → Spend panel on a real vault: same axes, same curves, same bars.

- [ ] **Step 6: Commit**

```bash
git add -A src package.json package-lock.json
git commit -m "chore(viz): drop d3-scale and d3-shape for two scales and one path

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: Repo hygiene, `.env.example`, docs, status

**Files:**
- Modify: `.gitignore` (add `.understand-anything/`), untrack `.understand-anything/**`
- Modify: `.env.example` (document `SCISPARK_SCHEDULER` — decision D1)
- Modify: `docs/design/03-backend.md` ("Search ranking = extracted intent" section), `docs/design/04-agent-harness.md` (Search-Intent row)
- Modify: `CLAUDE.md` (status entry; the "Fork-mock" bullet under *Real vs fork-mock surfaces*)
- Modify: `.superpowers/sdd/progress.md` (ledger entry; git-ignored scratch)

- [ ] **Step 1: Stop tracking the generated code-map (keep it locally)**

```bash
git rm -r --cached .understand-anything && printf '\n# understand-anything code map (generated, 2 MB; keep local)\n.understand-anything/\n' >> .gitignore
```
Run: `git status --short | grep understand` → only `D` entries; `ls .understand-anything` still lists the files.

- [ ] **Step 2: Document the scheduler flag**

Append to `.env.example`:

```
# Background scheduler - optional. "on" starts the server heartbeat that runs the self-gated
# trending auto-refresh, memory consolidation and deterministic lint on a timer; unset/off = manual only.
SCISPARK_SCHEDULER=
```

- [ ] **Step 3: Docs**

- `docs/design/03-backend.md`, section "Search ranking = extracted intent": append one sentence — *"2026-09-12: the standalone Search-Intent skill/route/client were retired (no caller after SP2); the research-search planner's `sort: relevance|date` (`src/lib/skills/research-search.ts`) is where intent is extracted before search."*
- `docs/design/04-agent-harness.md`, the Search-Intent row: mark it *"retired 2026-09-12 — folded into Research-Search's planner"*.
- `CLAUDE.md`: in the *Real vs fork-mock surfaces* section, remove `/library` from the fork-mock list. In the status block (the long "What this project is" paragraph), append: **"Post-v1 cleanup (2026-09-12, branch `chore/ponytail-audit-cleanup`): repo-wide ponytail audit applied — ~1,900 lines deleted (fork-era components, RightPanel, LegacyPrototypeWarning, the orphaned search-intent skill, feed rank/rerank skills, get-vault fallback, 12 `jsonResponse` copies, ~10 duplicated helpers), `framer-motion`/`@anthropic-ai/sdk`/`d3-scale`/`d3-shape` removed (CSS transitions, raw Messages-API fetch, arithmetic). Kept by decision: scheduler heartbeat (flag now in `.env.example`), review reservation ledger, both force engines, vault import. Spec `docs/superpowers/specs/2026-09-12-ponytail-audit-cleanup-design.md`."**
- `.superpowers/sdd/progress.md`: one ledger line per task as they land (task number, commit, review outcome, test count).

- [ ] **Step 4: Final verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: tsc clean; lint 0 errors / 1 warning (the pre-existing one); suite green with 16 skipped (the live search-intent gate is gone) and a passed count ≈ 2575 − deleted cases + 11 added; build succeeds with no `/library` or `/api/skills/search-intent` route listed.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example docs CLAUDE.md
git commit -m "docs: record the ponytail audit cleanup; untrack the generated code map

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage:** spec rows 1→Task 1, 2→Task 2, 3→Task 3, 4→Task 4, 5→Task 5, 6→Task 6, 7→Task 7, 8→Task 8, 9→Tasks 9–11, 10→Task 12, 11→Task 11 step 7, 12→Task 13, 13→Task 14, 14→Task 15, 15→Task 16. Decisions D1–D5 have no tasks by design (D1's documentation is Task 16 step 2).
- **Type consistency:** `getOpenVault` (Task 7) is the name the pages already import; `useUIStore` fields kept in Task 3 are exactly those Task 13 reads; `parseJsonLoosely` is defined in Task 11 before Task 14 imports it; `SOURCE_FETCH_TIMEOUT_MS`/`clampLimit` both live in `src/lib/papers/types.ts` (Tasks 10 and 12 append to the same file — no conflict); `readSettingsFile`/`readRefreshFailureReason` names are used consistently across Task 9's steps.
- **Ordering dependencies:** Task 3 before Task 13 (AppShell edits), Task 11 before Task 14 (`parseJsonLoosely`), Task 10 before Task 12 only for tidiness (same `types.ts`).
