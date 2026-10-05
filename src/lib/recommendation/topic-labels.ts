/** Display labels only. Keep full recommendation evidence in its disclosure. */
function topicLabel(raw: string): string | null {
  let label = raw.trim().replace(/^[-*]\s+/, "").replace(/\*\*/g, "").split(/\s+[—–]\s+/)[0].trim()
  if (/^(?:search\s+["“']|(?:look for|find papers|include|exclude|avoid|prefer)\b)/i.test(label)) return null
  // Old comma-split topics sometimes retained half a parenthetical. Remove
  // only that fragment; preserve balanced technical qualifiers such as (EEG).
  label = label.replace(/\s*\([^)]*$/, "").replace(/^[^(]*\)/, (prefix) => prefix.slice(0, -1)).trim()
  if (!label || label.length > 80 || label.split(/\s+/).length > 12 || /[.!?]\s|[:\n]/.test(label)) return null
  return label
}

export function feedTopicLabels(tags: readonly string[], fields: readonly string[]): string[] {
  const clean = (values: readonly string[]) => {
    const unique = new Map<string, string>()
    for (const value of values) {
      const label = topicLabel(value)
      if (label && !unique.has(label.toLocaleLowerCase())) unique.set(label.toLocaleLowerCase(), label)
    }
    return [...unique.values()].slice(0, 3)
  }
  const labels = clean(tags)
  return labels.length ? labels : clean(fields)
}
