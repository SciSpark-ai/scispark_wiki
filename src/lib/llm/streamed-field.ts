/** Read only a top-level JSON string, tolerating an unfinished value/escape.
 * Nested strings, reasoning, other fields and raw JSON never reach the UI.
 * This is a preview decoder, NOT validation: zod still checks the final result.
 */
export function streamedStringField(raw: string, field: string): string {
  const source = raw.replace(/^\s*```(?:json)?\s*/i, "").trimStart()
  if (!source.startsWith("{")) return ""
  let depth = 0
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === "{" || char === "[") depth++
    else if (char === "}" || char === "]") depth--
    else if (char === '"') {
      const start = i++
      for (; i < source.length; i++) {
        if (source[i] === "\\") i++
        else if (source[i] === '"') break
      }
      if (i >= source.length) return ""
      if (depth !== 1) continue
      let key: string
      try { key = JSON.parse(source.slice(start, i + 1)) } catch { return "" }
      if (key !== field) continue
      const match = /^\s*:\s*"/.exec(source.slice(i + 1))
      if (!match) continue
      let value = ""
      for (let j = i + 1 + match[0].length; j < source.length; j++) {
        const c = source[j]
        if (c === '"') return value
        if (c !== "\\") { value += c; continue }
        const next = source[++j]
        if (next === undefined) break
        if (next === "u") {
          const hex = source.slice(j + 1, j + 5)
          if (!/^[\da-f]{4}$/i.test(hex)) break
          value += String.fromCharCode(parseInt(hex, 16))
          j += 4
        } else {
          const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }
          if (!(next in escapes)) break
          value += escapes[next]
        }
      }
      // Do not briefly render half of a surrogate pair.
      return value.replace(/[\uD800-\uDBFF]$/, "")
    }
  }
  return ""
}
