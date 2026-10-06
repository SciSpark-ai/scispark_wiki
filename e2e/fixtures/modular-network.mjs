// Test-process transport only. No production imports or readiness overrides.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
const root = process.env.SCISPARK_E2E_RUN_DIR
if (!root || !/scispark-e2e-/.test(root)) throw new Error("Disposable fixture root required")
const evidence = join(root, "evidence"); mkdirSync(evidence, { recursive: true })
const original = globalThis.fetch
const sha = "1".repeat(40)
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return original(input, options)
  if (url.href === "https://api.openai.com/v1/chat/completions") {
    return original(`http://127.0.0.1:${process.env.SCISPARK_E2E_LLM_PORT}/v1/chat/completions`, options)
  }
  if (url.href === "https://api.github.com/repos/scispark-fixture/modular/commits/HEAD") {
    appendFileSync(join(evidence, "source.jsonl"), JSON.stringify({ fixture: "github-commit", sha }) + "\n")
    return Response.json({ sha })
  }
  if (url.href === `https://api.github.com/repos/scispark-fixture/modular/zipball/${sha}`) {
    appendFileSync(join(evidence, "source.jsonl"), JSON.stringify({ fixture: "github-archive", sha }) + "\n")
    return new Response(readFileSync(join(root, "github-fixture.zip")), { headers: { "content-type": "application/zip" } })
  }
  appendFileSync(join(evidence, "source.jsonl"), JSON.stringify({ fixture: "rejected-network", origin: url.origin, pathname: url.pathname }) + "\n")
  throw new Error("Offline fixture rejected an unmatched external request")
}
// Acquisition deliberately uses pinned node:https rather than fetch. Keep its
// public-address validation intact while replacing only fixture DNS/bytes.
import https from "node:https"
import dns from "node:dns/promises"
import { syncBuiltinESMExports } from "node:module"
import { Readable } from "node:stream"
import { EventEmitter } from "node:events"
const lookup = dns.lookup
dns.lookup = async (host, options) => {
  if (host === "api.github.com") return [{ address: "140.82.112.6", family: 4 }]
  if (host === "localhost" || host === "127.0.0.1") return lookup(host, options)
  throw new Error("Offline fixture DNS miss")
}
https.request = (input, options, callback) => {
  const url = new URL(input)
  const req = new EventEmitter()
  req.end = () => { queueMicrotask(() => {
    let bytes
    if (url.href === "https://api.github.com/repos/scispark-fixture/modular/commits/HEAD") bytes = Buffer.from(JSON.stringify({ sha }))
    else if (url.href === `https://api.github.com/repos/scispark-fixture/modular/zipball/${sha}`) bytes = readFileSync(join(root, "github-fixture.zip"))
    else { appendFileSync(join(evidence, "source.jsonl"), JSON.stringify({ fixture: "https-miss", pathname: url.pathname }) + "\n"); req.emit("error", new Error("Offline fixture HTTPS miss")); return }
    appendFileSync(join(evidence, "source.jsonl"), JSON.stringify({ fixture: "github-pinned-transport", pathname: url.pathname, sha }) + "\n")
    const response = Readable.from([bytes]); response.statusCode = 200; response.headers = { "content-type": "application/octet-stream" }; callback(response)
  }); return req }
  return req
}
syncBuiltinESMExports()
