import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { Frontmatter } from "./types"

export class FrontmatterError extends Error {}

const REQUIRED_KEYS = ["type", "title", "created", "updated", "tags", "related", "sources"] as const
const ARRAY_KEYS = ["tags", "related", "sources"] as const

const TERMINATOR_RE = /\n---[ \t]*(?:\n|$)/

export function parseDocument(raw: string): { frontmatter: Frontmatter; body: string } {
  const normalized = raw.replace(/\r\n/g, "\n")
  if (!normalized.startsWith("---\n")) throw new FrontmatterError("document must start with ---")
  const match = TERMINATOR_RE.exec(normalized.slice(3))
  if (!match) throw new FrontmatterError("unterminated frontmatter block")
  const end = 3 + match.index
  const yamlSrc = normalized.slice(4, end)
  // serializeDocument always writes exactly one blank-line spacer between the
  // closing "---" and the body ("---\n\n<body>\n"). The terminator regex above
  // only consumes the closing "---" line's own newline, so that mandatory
  // spacer blank line survives as the body's first character. Strip exactly
  // one leading "\n" here so it isn't counted as part of the body content —
  // without this, serializeDocument(parseDocument(raw)) is not byte-identical
  // to a `raw` that was itself produced by serializeDocument (it grows an
  // extra blank line every round trip), which breaks any conflict check that
  // compares freshly-serialized content against what's actually on disk.
  const body = normalized.slice(end + match[0].length).replace(/^\n/, "")

  let data: unknown
  try {
    data = parseYaml(yamlSrc)
  } catch (e) {
    throw new FrontmatterError(`invalid YAML: ${(e as Error).message}`)
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new FrontmatterError("frontmatter must be a mapping")
  }
  const fm = data as Record<string, unknown>
  for (const key of REQUIRED_KEYS) {
    if (!(key in fm)) throw new FrontmatterError(`missing required key: ${key}`)
  }
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(fm[key])) throw new FrontmatterError(`${key} must be an array`)
  }
  for (const key of ["type", "title"]) {
    if (typeof fm[key] !== "string" || !(fm[key] as string).trim()) {
      throw new FrontmatterError(`${key} must be a non-empty string`)
    }
  }
  // YAML parses bare dates as Date objects; normalize to YYYY-MM-DD strings
  for (const key of ["created", "updated"]) {
    const v = fm[key]
    if (v instanceof Date) fm[key] = v.toISOString().slice(0, 10)
    else if (typeof v !== "string") throw new FrontmatterError(`${key} must be a date string`)
  }
  return { frontmatter: fm as Frontmatter, body }
}

export function serializeDocument(frontmatter: Frontmatter, body: string): string {
  const yamlSrc = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd()
  return `---\n${yamlSrc}\n---\n\n${body.trimEnd()}\n`
}
