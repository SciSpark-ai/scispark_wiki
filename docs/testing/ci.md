# Continuous integration

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatch.
It uses Ubuntu, Node 24.3.0, `npm ci`, read-only repository permissions, and
commit-pinned official GitHub actions. Superseded runs are cancelled.

## Required checks

- **Lint, types, and unit tests**: ESLint, Next route type generation, TypeScript,
  and the full Vitest suite with two workers.
- **Production build and browser smoke**: builds `.next-ci`, then runs Chromium
  onboarding, chat landing/navigation, and streaming tests against that build.
  Onboarding and chat runs receive separate disposable vaults and local mock
  provider services. Failed browser runs retain reports, screenshots, video,
  and traces for seven days.

No provider credentials are configured in CI. Live model gates remain skipped,
README capture remains opt-in, and neither personal vaults nor production
servers are used. CI does not deploy the app.

## Reproduce locally

```sh
npm ci
npm run lint
npx next typegen
npx tsc --noEmit
npm test -- --maxWorkers=2
npx playwright install chromium
SCISPARK_LIVE_GATE_DIST_DIR=.next-ci SCISPARK_SCHEDULER=off npm run build
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-ci SCISPARK_SCHEDULER=off npm run e2e -- e2e/first-run-setup.spec.ts
SCISPARK_E2E_PRODUCTION_DIST_DIR=.next-ci SCISPARK_SCHEDULER=off npm run e2e -- e2e/chat-start.spec.ts e2e/streaming.spec.ts
```

Require both named checks to pass on an up-to-date pull request before merging
into `main`. Add new browser cases to the smoke selection when they are stable;
run the broader browser suite explicitly for changes outside this selection.
