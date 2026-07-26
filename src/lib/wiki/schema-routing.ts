import type { VaultStorage } from "../vault/storage"

/**
 * Built-in type -> directory map, mirroring the private TYPE_DIRS table that
 * scaffold.ts writes into a freshly-created vault's schema.md. Kept in sync
 * manually (scaffold.test.ts's scaffold-parity assertions plus this module's
 * own scaffold-parity test both break if the two drift apart).
 */
export const DEFAULT_ROUTING: Record<string, string> = {
  paper: "wiki/papers",
  concept: "wiki/concepts",
  method: "wiki/methods",
  finding: "wiki/findings",
  comparison: "wiki/comparisons",
  author: "wiki/authors",
  topic: "wiki/topics",
  note: "wiki/notes",
  query: "wiki/queries",
  idea: "wiki/ideas",
  project: "wiki/projects",
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/
const TYPE_RE = /^[a-z][a-z0-9_-]*$/i

/**
 * Parses the "## Page Types" section of a schema.md (llm_wiki-style routing
 * table: `| type | dir |` rows) into a type -> directory map. The heading can
 * be any level (##-######) and is matched case-insensitively on "page types".
 * Rows are read until the next heading of the same or shallower level (or
 * end of document). Rows that don't look like a valid `| type | dir |` pair
 * — including the table's own header/separator rows — are silently skipped.
 */
export function parseSchemaRouting(markdown: string): Record<string, string> {
  const lines = markdown.split(/\r?\n/)

  let sectionLevel = -1
  let startIdx = -1
  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING_RE.exec(lines[i])
    if (heading && heading[2].trim().toLowerCase() === "page types") {
      sectionLevel = heading[1].length
      startIdx = i + 1
      break
    }
  }
  if (startIdx === -1) return {}

  const routing: Record<string, string> = {}

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]

    const heading = HEADING_RE.exec(line)
    if (heading && heading[1].length <= sectionLevel) break

    const row = TABLE_ROW_RE.exec(line)
    if (!row) continue
    const cells = row[1].split("|").map((c) => c.trim())
    if (cells.length < 2) continue

    const [rawType, rawDir] = cells
    if (!TYPE_RE.test(rawType)) continue
    if (rawDir !== "wiki" && !rawDir.startsWith("wiki/")) continue

    const dir = rawDir.replace(/\/+$/, "")
    routing[rawType.toLowerCase()] = dir
  }

  return routing
}

/**
 * Reads and parses schema.md's routing table. Falls back to DEFAULT_ROUTING
 * when the file is missing or its Page Types table is missing/empty.
 */
export async function loadRouting(storage: VaultStorage): Promise<Record<string, string>> {
  const content = await storage.read("schema.md")
  const parsed = content === null ? {} : parseSchemaRouting(content)
  return Object.keys(parsed).length === 0 ? DEFAULT_ROUTING : parsed
}

const SLUG_KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/
// Han (+ extension A + compatibility), Hiragana/Katakana, Hangul syllables.
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힣]/

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? "" : path.slice(0, idx)
}

function baseOf(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx === -1 ? path : path.slice(idx + 1)
}

function isValidSlug(slug: string): boolean {
  if (slug.length === 0) return false
  if (/[A-Z]/.test(slug)) return false
  if (slug.includes(" ")) return false
  if (slug.startsWith(".")) return false
  if (slug.includes("..")) return false
  if (slug.includes("_")) return false
  if (SLUG_KEBAB_RE.test(slug)) return true
  return CJK_RE.test(slug)
}

/**
 * Validates a proposed changeset's file list against the schema routing map.
 * Checks, per file, in order: type is registered in `routing`; the file's
 * directory matches routing[type]; the path ends in `.md`; the final path
 * segment (minus `.md`) is a valid slug (kebab-case, or containing CJK
 * characters). All applicable errors across all files are returned — this
 * never stops at the first failure.
 *
 * Note: Type matching is case-insensitive; routing keys are stored lowercase
 * (by parseSchemaRouting), so the input type is normalized to lowercase for
 * lookup. The original type casing is preserved in error messages.
 */
export function validateFilesAgainstRouting(
  files: Array<{ path: string; type: string }>,
  routing: Record<string, string>,
): string[] {
  const errors: string[] = []

  for (const { path, type } of files) {
    const dir = routing[type.toLowerCase()]
    if (dir === undefined) {
      errors.push(`unknown type "${type}" for ${path}`)
    } else if (dirOf(path) !== dir) {
      errors.push(`type "${type}" pages belong in ${dir}/ — got ${path}`)
    }

    if (!path.endsWith(".md")) {
      errors.push(`${path} is not a markdown file (.md required)`)
      continue
    }

    const slug = baseOf(path).slice(0, -".md".length)
    if (!isValidSlug(slug)) {
      errors.push(`${path} has an invalid filename slug: "${slug}"`)
    }
  }

  return errors
}
