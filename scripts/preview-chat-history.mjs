#!/usr/bin/env node
/** Disposable, offline UI preview. Never reads the real vault or provider keys. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

const port = Number(process.env.SCISPARK_CHAT_PREVIEW_PORT ?? 3124)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port")
const vault = await mkdtemp(join(tmpdir(), "scispark-chat-preview-"))
await mkdir(join(vault, ".scispark/chats"), { recursive: true })
const now = new Date().toISOString()
const result = {
  query: "Compare approaches to auditory attention decoding",
  plan: { interpretation: "Auditory attention decoding methods", sort: "relevance", fromDate: null,
    queries: [{ source: "pubmed", query: "auditory attention decoding methods", rationale: "Compare study methods." }] },
  items: Array.from({ length: 4 }, (_, i) => ({
    paper: { ids: { doi: `10.1234/offline-fixture-${i}` }, title: `Offline fixture ${i + 1}: comparing auditory attention decoding methods`,
      abstract: "This fictional paper is only a UI test fixture. It is not scientific evidence or a real publication.",
      authors: [{ name: "Fixture Author" }], year: 2026, venue: "Offline Test Fixtures", fields: ["Neuroscience"], source: "pubmed" },
    score: 90, whyMatch: "A saved result snapshot for testing navigation and History.", foundBy: [{ source: "pubmed", rationale: "Fixture search" }],
  })), stats: { retrieved: 4, deduplicated: 4 }, costUsd: 0, warnings: ["Offline preview — these are fictional test papers."] }
const session = { id: "chat_offline_preview", title: "Offline search-history walkthrough", createdAt: now, updatedAt: now,
  messages: [{ role: "user", content: result.query }, { role: "assistant", content: "Here are the saved results from this fixture search.", blocks: [{ type: "paper-results", retrievedAt: now, result }] }] }
await writeFile(join(vault, ".scispark/chats/chat_offline_preview.json"), JSON.stringify(session))
await writeFile(join(vault, ".scispark/settings.json"), JSON.stringify({ paperSources: { enabledSources: ["pubmed", "openalex"] }, ui: { theme: "light" }, companion: { chattiness: "off", companionName: "Sparky" } }))
console.log(JSON.stringify({ url: `http://127.0.0.1:${port}/chat/chat_offline_preview`, vault, paidCalls: 0 }))
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: "inherit", env: { ...process.env, SCISPARK_VAULT: vault, SCISPARK_LIVE_GATE_DIST_DIR: ".next-chat-preview", NEXT_TELEMETRY_DISABLED: "1" },
})
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal))
child.once("exit", (code) => { process.exitCode = code ?? 1 })
