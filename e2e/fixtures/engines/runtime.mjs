import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { reviewResponse } from "../review-responses.mjs"
export async function fixture(engine) {
  const args = process.argv.slice(2)
  if (args.includes("--version")) { console.log(engine === "codex" ? "codex-cli 0.159.0" : "2.1.210 (Claude Code)"); return }
  if (args.includes("status")) { console.log(engine === "codex" ? "Logged in using ChatGPT" : JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })); return }
  if (args[0] === "app-server") {
    const ids = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "model", "fixture/custom-model"]
    for await (const line of createInterface({ input: process.stdin })) {
      const message = JSON.parse(line)
      if (message.method === "initialize") console.log(JSON.stringify({ id: message.id, result: {} }))
      else if (message.method === "model/list") console.log(JSON.stringify({ id: message.id, result: { data: ids.map(model => ({ model, displayName: model })), nextCursor: null } }))
      else if (message.method !== "initialized") throw new Error("Fixture catalog must never receive an inference request")
    }
    return
  }
  let input = ""
  for await (const chunk of process.stdin) input += chunk
  if (input.includes("FIXTURE_HANG")) { setInterval(() => {}, 1000); return }
  if (input.includes("FIXTURE_ERROR")) { console.error("credential=DO-NOT-LEAK"); process.exitCode = 1; return }
  // The model-recovery browser fixture deliberately succeeds after the user
  // switches from the default analysis model to the available Terra model.
  if (input.includes("FIXTURE_NETWORK_FAILURE") && args[args.indexOf("--model") + 1] !== "gpt-5.6-terra") { console.error("stream disconnected before completion: error sending request; credential=DO-NOT-LEAK"); process.exitCode = 1; return }
  const schemaFlag = engine === "codex" ? "--output-schema" : "--json-schema"
  const raw = args[args.indexOf(schemaFlag) + 1]
  const conversation = input.split("Conversation (JSON):\n")[1]
  const schema = args.includes(schemaFlag) ? JSON.parse(engine === "codex" ? readFileSync(raw, "utf8") : raw)
    : input.includes("Return ONLY a JSON value matching this exact schema") ? JSON.parse(input.slice(input.lastIndexOf("\n") + 1)) : null
  const messages = JSON.parse(conversation.split("\n")[0])
  // Keep the first planning call in flight while the browser leaves/reopens it.
  if (input.includes("FIXTURE_REVIEW_SLOW") && messages.some(m => m.content.startsWith("Define the essential"))) await new Promise(resolve => setTimeout(resolve, 15_000))
  let value = reviewResponse(messages)
  if (!value) {
    const keys = Object.keys(schema?.properties ?? {})
    if (keys.includes("queries") && input.includes("SCISPARK_FEED_FIXTURE")) {
      await new Promise(resolve => setTimeout(resolve, 15_000))
      value = { queries: [{ source: "arxiv", query: "SCISPARK_FEED_FIXTURE", rationale: "Disposable navigation fixture" }] }
    }
    else if (keys.includes("assessments") && input.includes("SCISPARK_FEED_FIXTURE")) {
      if (input.includes("FIXTURE_FEED_FAIL")) { console.error("The selected model is not supported; fixture failure"); process.exitCode = 1; return }
      const content = messages.find(message => message.content.includes("<<<PAPERS>>>"))?.content ?? ""
      const papers = JSON.parse(content.split("<<<PAPERS>>>\n")[1].split("\n<<<END>>>")[0])
      value = { assessments: papers.map(({ index }) => ({ index, question: { grade: 4, evidence: "Sparse attention methods" }, topic: { grade: 4, evidence: "Sparse attention methods" }, approach: { grade: null, evidence: "" }, matches: [], excluded: false, memoryMatches: [] })) }
    }
    else if (keys.includes("draft") && keys.includes("question")) value = { message: "What research do you work on, Ada?", draft: { name: "Ada", role: "", fields: "", topics: "", feedPrefs: "", diversity: null, diversityNote: "", learnFromFeedback: null }, question: "research" }
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
    if (input.includes("FIXTURE_RECONNECT_SUCCESS")) emit({ type: "error", message: "Reconnecting... 1/5 (stream disconnected before completion)" })
    emit({ type: "item.completed", item: { type: "agent_message", text } })
    emit({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 10 } })
  } else {
    emit({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })
    emit({ type: "result", subtype: "success", result: text, ...(schema ? { structured_output: value } : {}), usage: { input_tokens: 80, output_tokens: 20, cache_read_input_tokens: 10, cache_creation_input_tokens: 10 } })
  }
}
