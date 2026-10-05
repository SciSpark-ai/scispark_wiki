/** Best-effort JSON from a model reply: the raw text, then a ```json fence, then
 * the outermost {...} / [...]. Prompt-embedded JSON fallbacks wrap output in
 * fences or prose despite instructions; zod re-validation stays the enforcement layer. */
export function parseJsonLoosely(text: string): unknown {
  for (const candidate of jsonCandidates(text)) {
    try { return JSON.parse(candidate) } catch { /* try next */ }
  }
  return undefined
}

function jsonCandidates(text: string): string[] {
  const out: string[] = [text.trim()]
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out.push(fenced[1].trim())
  const objStart = text.indexOf("{")
  const objEnd = text.lastIndexOf("}")
  if (objStart >= 0 && objEnd > objStart) out.push(text.slice(objStart, objEnd + 1))
  const arrStart = text.indexOf("[")
  const arrEnd = text.lastIndexOf("]")
  if (arrStart >= 0 && arrEnd > arrStart) out.push(text.slice(arrStart, arrEnd + 1))
  return out
}
