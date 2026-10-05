# Sparky Markdown rendering

The popup and full chat previously interpolated assistant text into a plain
paragraph. Both now use the existing React-node Markdown renderer for saved and
streaming answers. Bold, italics, numbered/bulleted lists, headings, tables and
code render without changing saved transcripts. Chat paragraph line breaks stay
visible; numbered options retain their starting number across blank lines.

User messages and selected passages remain literal. Raw HTML stays escaped.
Model-written Markdown links render as labels; navigation and saving remain in
the existing validated citation cards and completed-message actions. The writing
cursor follows the last rendered block and still respects reduced motion.

## Verification

- Regression reproduced before implementation: saved and streamed bold/list
  assertions both failed. Four new cases cover formatting, incremental updates,
  inert HTML/links, and literal user input.
- Full Vitest suite: **2,710 passed, 19 skipped**. After the final line-break
  refinement, chat and shared-renderer tests: **44 passed**.
- `npx tsc --noEmit`: passed.
- `npm run lint`: zero errors; the existing ConnectAiCard `applyPreset`
  exhaustive-deps warning remains.
- `npm run build`: passed with `.next-sparky-markdown-final` as the isolated
  output directory.
- Production Playwright Markdown/streaming checks: **5 passed**. Covers the
  paper popup, full conversation, reload, API/Codex fixture streaming, 390px and
  desktop layouts, table/code overflow, and reduced motion. The first run exposed
  an ambiguous paragraph selector and a pre-existing navigation race in the test;
  selectors now target the last paragraph and navigation waits for the chat URL.
- Reopened the user's existing “Explain: CNNT” conversation on localhost and
  visually verified bold labels and numbered options. No real model request was
  made and no saved transcript was rewritten.

Visual proof: `sparky-markdown.png` in this chat's visualization folder.
The local server is serving `.next-sparky-markdown-final` on port 3000.
