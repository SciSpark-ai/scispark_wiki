import { GENERATED_CARDS } from "./pattern-cards/generated-cards"

export interface PatternCard {
  id: string
  alias: string
  signature: string
  body: string
  kind: "pattern" | "sub-pattern"
}

const PLAIN_ALIAS_RE = /\*\*Plain alias\*\*\.\s*_([^_]+)_/
const OPERATIONAL_SIGNATURE_RE = /\*\*Operational signature\*\*\.\s*(.+)/
const TITLE_RE = /^#\s+(.+)$/m
const PARENT_NAME_RE = /_parent:\s*\*\*([^*]+)\*\*/

const FALLBACK_SIGNATURE_MAX_LENGTH = 200

/**
 * First real content line of a card, skipping the title heading, any other
 * heading, and metadata lines like `_id: ...` / `_parent: ...` / table rows.
 * Used as the operational-signature fallback for cards that don't follow the
 * standard pattern-card structure (sub-pattern clusters, the two `overview.md`
 * index docs, `companion-combos.md`) — see loadPatternCards below.
 */
function extractFallbackSignature(raw: string): string {
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim()
    if (line === "") continue
    if (line.startsWith("#")) continue
    if (line.startsWith("_") && line.endsWith("_")) continue
    if (line.startsWith("|")) continue
    return line.length > FALLBACK_SIGNATURE_MAX_LENGTH
      ? line.slice(0, FALLBACK_SIGNATURE_MAX_LENGTH).trimEnd() + "…"
      : line
  }
  return ""
}

/**
 * Parses one bundled card's raw markdown into a `PatternCard`.
 *
 * Standard pattern cards (the 15 named patterns under `patterns/`) carry a
 * known structure — `_id: \`...\`_`, `**Plain alias**. _..._`,
 * `**Operational signature**. ...` — which is parsed directly. Cards that
 * don't follow that structure (the 31 sub-pattern cluster cards `C00`–`C30`,
 * and the two `overview.md` index docs plus `companion-combos.md`, which are
 * reference documents rather than single-pattern cards) fall back
 * gracefully: id from the filename, alias from the sub-pattern's stated
 * parent pattern name (or the card's own title), and signature from the
 * first real content line — so every card still comes back with a
 * non-empty id/alias/signature/body.
 *
 * Id is normally the filename stem, which already matches each standard
 * pattern card's own `_id:` value. The one collision this scheme would hit
 * — both card directories have a reference `overview.md` — is disambiguated
 * by namespacing that one filename with its directory kind.
 */
function parseCard(file: string, kind: "pattern" | "sub-pattern", raw: string): PatternCard {
  const stem = file.replace(/\.md$/, "")
  const id = stem === "overview" ? (kind === "pattern" ? "patterns-overview" : "sub-patterns-overview") : stem
  const body = raw.trim()

  const titleMatch = TITLE_RE.exec(raw)
  const title = titleMatch ? titleMatch[1].trim() : id

  const aliasMatch = PLAIN_ALIAS_RE.exec(raw)
  const parentMatch = PARENT_NAME_RE.exec(raw)
  const alias = aliasMatch ? aliasMatch[1].trim() : parentMatch ? parentMatch[1].trim() : title

  const signatureMatch = OPERATIONAL_SIGNATURE_RE.exec(raw)
  const signature = signatureMatch ? signatureMatch[1].trim() : extractFallbackSignature(raw) || title

  return { id, alias, signature, body, kind }
}

let cache: PatternCard[] | null = null

/**
 * Parses the bundled `.md` cards (inlined at build time into
 * `./pattern-cards/generated-cards.ts` — see that file's header for the
 * regen command) into the in-memory `PatternCard[]` catalog. Pure and
 * memoized; safe to call repeatedly from any skill/orchestrator.
 */
export function loadPatternCards(): PatternCard[] {
  if (cache) return cache
  cache = GENERATED_CARDS.map((c) => parseCard(c.file, c.kind, c.raw))
  return cache
}

/**
 * Compact one-line-per-card index (`- <id> (<alias>): <signature>`) for
 * injecting the whole pattern catalog into a single ideation prompt.
 */
export function patternIndex(cards: PatternCard[]): string {
  return cards.map((c) => `- ${c.id} (${c.alias}): ${c.signature}`).join("\n")
}

/** Filters `cards` down to the ones whose `id` is in `ids`, preserving `ids`' order; unknown ids are silently dropped. */
export function cardsByIds(cards: PatternCard[], ids: string[]): PatternCard[] {
  const byId = new Map(cards.map((c) => [c.id, c]))
  const out: PatternCard[] = []
  for (const id of ids) {
    const card = byId.get(id)
    if (card) out.push(card)
  }
  return out
}
