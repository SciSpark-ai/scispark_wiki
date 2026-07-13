#!/usr/bin/env node
// Regenerates src/lib/spark/pattern-cards/generated-cards.ts by inlining the
// raw text of every bundled ideation-pattern / sub-pattern .md card as a
// string constant. Committed output, not built at runtime — this keeps card
// loading a plain data import that works identically under `npm run build`
// (Next/Turbopack) and `vitest` (node), with no fs/glob access needed by
// src/lib/spark/pattern-cards.ts at import time.
//
// Regen command (from repo root):
//   node scripts/generate-spark-cards.mjs
//
// Run this after adding/editing/removing any file under
// src/lib/spark/pattern-cards/{patterns,sub-patterns}/.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const CARDS_ROOT = join(__dirname, "..", "src", "lib", "spark", "pattern-cards")

/** @param {string} dir @param {"pattern"|"sub-pattern"} kind */
function collect(dir, kind) {
  const full = join(CARDS_ROOT, dir)
  const files = readdirSync(full).filter((f) => f.endsWith(".md")).sort()
  return files.map((file) => ({
    file,
    kind,
    raw: readFileSync(join(full, file), "utf8"),
  }))
}

const entries = [...collect("patterns", "pattern"), ...collect("sub-patterns", "sub-pattern")]

const header = `// AUTO-GENERATED — do not hand-edit.
// Regenerate with: node scripts/generate-spark-cards.mjs
// (after adding/editing/removing a file under
// src/lib/spark/pattern-cards/{patterns,sub-patterns}/)
//
// Inlines the raw text of every bundled ResearchStudio ideation-pattern /
// sub-pattern card as a string constant, so src/lib/spark/pattern-cards.ts
// can parse them via a plain data import — no fs/glob access at import time,
// which keeps card loading identical under \`npm run build\` (Next/Turbopack)
// and \`vitest\` (node). See ./NOTICE.md for attribution.

export interface GeneratedCard {
  file: string
  kind: "pattern" | "sub-pattern"
  raw: string
}

export const GENERATED_CARDS: GeneratedCard[] = [
`

const body = entries
  .map((e) => `  { file: ${JSON.stringify(e.file)}, kind: ${JSON.stringify(e.kind)}, raw: ${JSON.stringify(e.raw)} },`)
  .join("\n")

const footer = `\n]\n`

writeFileSync(join(CARDS_ROOT, "generated-cards.ts"), header + body + footer)
console.log(`Wrote ${entries.length} cards to ${join(CARDS_ROOT, "generated-cards.ts")}`)
