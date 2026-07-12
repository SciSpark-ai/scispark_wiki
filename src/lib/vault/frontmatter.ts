import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import type { Frontmatter } from "./types"

export class FrontmatterError extends Error {}

const REQUIRED_KEYS = ["type", "title", "created", "updated", "tags", "related", "sources"] as const
const ARRAY_KEYS = ["tags", "related", "sources"] as const

export function parseDocument(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) throw new FrontmatterError("document must start with ---")
  const end = raw.indexOf("\n---", 4)
  if (end === -1) throw new FrontmatterError("unterminated frontmatter block")
  const yamlSrc = raw.slice(4, end)
  const body = raw.slice(end + 4).replace(/^\r?\n/, "")

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
