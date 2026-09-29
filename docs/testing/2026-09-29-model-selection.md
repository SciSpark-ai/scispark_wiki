# Local engine model selection

Settings → Connect your AI → Codex or Claude Code now presents model dropdowns
for analysis and quick steps. Choose the same model for both or separate models,
then select **Save models** (or **Use Codex / Use Claude Code** when switching
engines). **Custom model…** accepts another model ID and preserves existing IDs
that are not in the suggestions. Defaults and saved selections are not migrated.

Choices are stored in the active profile's vault and apply to new requests.
Saving checks CLI readiness but makes no inference call. **Save & test models
(uses plan)** remains the explicit inference action. Saved choices, unsaved
changes, invalid input, and save failures are distinguished in the UI. API-key
provider controls are unchanged.

The Codex suggestions were checked against visible entries in the installed
official CLI's model metadata on September 29, 2026. They are a static suggestion
list, not a live account entitlement check. Claude Sonnet, Opus, and Haiku use
the aliases documented in [Claude Code's model configuration guide](https://code.claude.com/docs/en/model-config).
Access depends on the user's account and CLI version; custom IDs remain available
as provider catalogs change.

## Verification

- Five new component regressions first failed against the old text-input UI,
  then passed: both-tier selection without inference, explicit Claude testing,
  custom ID retention/editing/trimming, invalid input, and save failure recovery.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors, the same single pre-existing exhaustive-deps
  warning in `ConnectAiCard.tsx`.
- `npx vitest run`: 2,613 passed, 17 skipped. No live-provider gates were enabled.
- Production build in `.next-models`: passed, 63/63 routes generated.
- Chromium: both local engines passed selecting and saving models, preserving
  them after reload, round-tripping custom IDs, testing both tiers, verifying
  the selected model IDs in the usage ledger, mobile layout, and onboarding.
  Subscription usage counts did not change when saving without testing.
- The existing two first-run setup scenarios and profile/vault isolation cycle
  also passed against the production build.
- The first custom-ID reload check initially failed because reloading closes
  Settings (a modal over the home page). The test now reopens Settings before
  checking persistence; both engine cases then passed.

All browser checks used disposable vaults and the deterministic Codex/Claude CLI
fixtures. They verify the application integration, not native inference or access
to every suggested model. No human research vault or subscription was used.

Reproduce the local-engine browser checks after building:

```sh
SCISPARK_LIVE_GATE_DIST_DIR=.next-models npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-models \
SCISPARK_CODEX_PATH="$PWD/e2e/fixtures/engines/codex.mjs" \
SCISPARK_CLAUDE_PATH="$PWD/e2e/fixtures/engines/claude.mjs" \
SCISPARK_SCHEDULER=off npm run e2e -- e2e/local-engines.spec.ts
```
