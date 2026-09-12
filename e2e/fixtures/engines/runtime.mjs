import { readFileSync } from "node:fs"
import { reviewResponse } from "../review-responses.mjs"
export async function fixture(engine) {
  const args = process.argv.slice(2)
  if (args.includes("--version")) { console.log(engine === "codex" ? "codex-cli 0.146.0" : "2.1.210 (Claude Code)"); return }
  if (args.includes("status")) { console.log(engine === "codex" ? "Logged in using ChatGPT" : JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); return }
  let input = ""
  for await (const chunk of process.stdin) input += chunk
  if (input.includes("FIXTURE_HANG")) { setInterval(() => {}, 1000); return }
  if (input.includes("FIXTURE_ERROR")) { console.error("credential=DO-NOT-LEAK"); process.exitCode = 1; return }
  const schemaFlag = engine === "codex" ? "--output-schema" : "--json-schema"
  const raw = args[args.indexOf(schemaFlag) + 1]
  const conversation = input.split("Conversation (JSON):\n")[1]
  const schema = args.includes(schemaFlag) ? JSON.parse(engine === "codex" ? readFileSync(raw, "utf8") : raw)
    : input.includes("Return ONLY a JSON value matching this exact schema") ? JSON.parse(input.slice(input.lastIndexOf("\n") + 1)) : null
  const messages = JSON.parse(conversation.split("\n")[0])
  let value = reviewResponse(messages)
  if (!value) {
    const keys = Object.keys(schema?.properties ?? {})
    if (keys.includes("draft") && keys.includes("question")) value = { message: "What research do you work on, Ada?", draft: { name: "Ada", role: "", fields: "", topics: "", feedPrefs: "", diversity: null, diversityNote: "", learnFromFeedback: null }, question: "research" }
    else if (keys.includes("message")) value = { message: "ready" }
    else if (keys.includes("pageIds")) value = { pageIds: [] }
    else if (keys.includes("answer")) value = { answer: "Fixture research answer grounded in the supplied context.", citedPageIds: [] }
    else value = { message: "ready" }
  }
  if (input.includes("FIXTURE_INVALID")) value = { wrong: true }
  const text = schema ? JSON.stringify(value) : "ready"
  const emit = (event) => console.log(JSON.stringify(event))
  if (engine === "codex") {
    emit({ type: "thread.started", thread_id: "fixture-codex" })
    emit({ type: "item.completed", item: { type: "error", message: "Nonfatal metadata diagnostic" } })
    emit({ type: "item.completed", item: { type: "agent_message", text } })
    emit({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 10 } })
  } else {
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })
    emit({ type: "result", subtype: "success", result: text, ...(schema ? { structured_output: value } : {}), usage: { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 10 } })
  }
}
