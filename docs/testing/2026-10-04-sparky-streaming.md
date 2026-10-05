# Sparky streaming and activity cues — October 4, 2026

## Change

The Codex adapter previously used `exec --json`, which supplied a completed
assistant message rather than incremental answer text. Requests with an `onText`
consumer now use the installed CLI's stdio app-server protocol. Other Codex skill
calls retain their existing exec transport. The adapter forwards only public
answer deltas, preserves structured-output validation and subscription metering,
and does not retry a failed or uncertain call. Claude's `StructuredOutput` tool
argument deltas now also reach the structured-answer preview.

Both floating Sparky and full chat show a short activity label with three moving
dots before answer text arrives, then a streaming cursor. Reduced motion disables
both effects. Paper acquisition reports “Reading this paper…”. Returning to a
running chat receives its latest in-memory text snapshot through the existing
read-only job endpoint; this starts no new model request. Final citation/save
controls remain hidden until the answer is validated and persisted.

## Verification

- TypeScript: passed (`npx tsc --noEmit`).
- ESLint: 0 errors; the existing `ConnectAiCard` exhaustive-deps warning remains.
- Full Vitest: **2,706 passed / 19 skipped**, 274 passing files / 7 skipped.
- Final engine regression run after dispatch accounting: **39 passed**.
- Production build: `.next-sparky-stream`, successful.
- Production Chromium: **5 passed**, including API and subprocess Codex fixture
  streaming, desktop/mobile, partial text before completion, opening full chat,
  reload during streaming, reduced-motion checks, selection-to-Sparky and saved
  answers. These use a disposable vault and deterministic providers.
- Installed Codex 0.159.0: generated protocol bindings and completed a real
  initialize → config/read → ephemeral thread/start handshake, without sending
  a turn or making an inference request. It reported the requested GPT-6-Astra
  model, read-only sandbox, never-approve policy, and all three configured MCP
  connections disabled with zero tools/resources.

The app-server has no `--ignore-user-config`. Streaming explicitly disables
hooks, plugins, shell/tools and project documentation, uses a scratch directory,
replaces base/developer instructions, disables each configured MCP server, and
rejects custom OpenAI routing. The CLI still reports its global AGENTS.md source;
this is distinct from the non-streaming exec transport's configuration isolation.
Only MCP server names with `enabled: false` are passed into the ephemeral thread;
no configured endpoints or credentials are replayed. One diagnostic proposing
full MCP configuration reuse was blocked by automatic review and was replaced
with this narrower check. Configuration output is not retained or exposed to UI.

No signed-in inference was performed. Real subscription answer generation is
not live-verified by these mock-provider tests or the protocol handshake.

## Screenshots

Saved under the local visualization directory `sparky-streaming`:
`api-thinking.png`, `api-streaming.png`, `codex-thinking.png`,
`codex-streaming.png`. The Codex fixture screenshots use a 390 × 844 viewport;
API screenshots use 1440 × 1000. Screenshots were visually inspected.

The local app on port 3000 was restarted with this production build after
checking saved skill-job statuses. No commit or push was made.
