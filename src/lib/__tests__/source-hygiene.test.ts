import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Repo-wide source-hygiene guard: no source file may contain raw control bytes
 * (C0 except tab/newline/CR). Literal NUL bytes have slipped into three source
 * files (M8: graph.ts, authors.ts, citations.ts) via generated "\x00" separators
 * being written as actual control characters — which makes git treat the file
 * as binary, producing unreviewable diffs and invisible-in-editor content.
 * Control characters in string literals must be written as escape sequences
 * (e.g. backslash-u0000), never as raw bytes.
 */

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".md", ".json"])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue
      yield* walk(full)
    } else {
      const dot = entry.lastIndexOf(".")
      if (dot !== -1 && SOURCE_EXTENSIONS.has(entry.slice(dot))) yield full
    }
  }
}

describe("source hygiene", () => {
  it("no source file under src/ contains raw control bytes", () => {
    const offenders: string[] = []
    for (const file of walk("src")) {
      const buf = readFileSync(file)
      for (const byte of buf) {
        // Allowed: tab (9), LF (10), CR (13). Everything else < 0x20 and DEL are raw control bytes.
        if ((byte < 0x20 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 0x7f) {
          offenders.push(file)
          break
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
