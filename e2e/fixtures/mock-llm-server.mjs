#!/usr/bin/env node

import { createServer } from "node:http"
import { reviewResponse } from "./review-responses.mjs"

const port = Number(process.env.SCISPARK_E2E_LLM_PORT)
if (!Number.isInteger(port)) throw new Error("SCISPARK_E2E_LLM_PORT is required")

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("ok")
    return
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ error: "not found" }))
    return
  }

  const chunks = []
  let size = 0
  request.on("data", (chunk) => {
    size += chunk.length
    if (size > 1_000_000) request.destroy(new Error("request too large"))
    else chunks.push(chunk)
  })
  request.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const prompt = Array.isArray(body.messages)
        ? body.messages.map((message) => String(message?.content ?? "")).join("\n")
        : ""
      const answers = (body.messages ?? []).filter((message) => message.role === "user").map((message) => message.content)
      const onboardingDraft = {
        name: answers[0] ?? "", role: answers.length > 1 ? "Postdoc" : "",
        fields: answers.length > 1 ? "Auditory neuroscience" : "",
        topics: answers.length > 2 ? "Language development and hearing" : "",
        feedPrefs: answers.length > 3 ? answers[3] : "",
        diversity: answers.length > 3 ? "exploratory" : null,
        diversityNote: answers.length > 3 ? "Mostly hearing research, with nearby computational methods. Variety is a preference, not a fixed quota." : "",
        learnFromFeedback: answers.length > 4 ? !/no|don.t|do not/i.test(answers[4]) : null,
      }
      const onboardingReplies = [
        ["What research are you working on, Ada?", "research"],
        ["What questions or methods would you like to follow?", "research"],
        ["Should I stay close to your research, or bring in ideas from nearby fields?", "diversity"],
        ["I’ll include nearby methods. Should I remember your thumbs-up and thumbs-down feedback for future recommendations?", "learning"],
        ["Check the profile below and change anything I missed.", "review"],
      ]
      const reply = onboardingReplies[Math.min(Math.max(0, answers.length - 1), 4)]
      const output = reviewResponse(body.messages) ?? (prompt.includes("Help this researcher shape a useful paper feed")
        ? { message: reply[0], draft: onboardingDraft, question: reply[1] }
        : prompt.includes("Connection test: reply with the word ready")
        ? { message: "ready" }
        : prompt.includes("You select which pages")
        ? { pageIds: ["e2e-grounding-paper"] }
        : prompt.includes("exactly ONE short")
          ? { utterance: "A possible duplicate needs your review." }
        : {
            answer: "The disposable paper supports this project-scoped answer.",
            citedPageIds: ["wiki/papers/e2e-grounding-paper"],
          })

      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
        const content = JSON.stringify(output)
        const split = Math.min(content.length, 35)
        response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(0, split) } }] })}\n\n`)
        // Hold the real provider response open so E2E proves the UI updates
        // BEFORE the completion is available, not a typewriter after buffering.
        const timer = setTimeout(() => {
          response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: content.slice(split) } }] })}\n\n`)
          response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } })}\n\n`)
          response.end("data: [DONE]\n\n")
        }, 1500)
        response.on("close", () => clearTimeout(timer))
        return
      }
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        id: "chatcmpl-e2e",
        object: "chat.completion",
        created: 0,
        model: body.model ?? "gpt-5.4-mini",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(output) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }))
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
})

server.listen(port, "127.0.0.1")

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
