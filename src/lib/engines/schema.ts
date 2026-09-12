/** Codex exec submits output-schema as strict structured output. SciSpark's
 * schemas may include optional fields/open records, which that dialect rejects.
 * Use prompt JSON for those contracts, preserving the original schema and Zod
 * validation instead of forcing missing evidence fields to become required. */
export function codexNativeSchema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return false
  const node = schema as Record<string, unknown>
  if ("default" in node) return false
  if (node.type === "object" || node.properties) {
    if (node.additionalProperties !== false) return false
    const properties = node.properties as Record<string, unknown> | undefined ?? {}
    const required = Array.isArray(node.required) ? node.required : []
    if (Object.keys(properties).some(key => !required.includes(key))) return false
    if (!Object.values(properties).every(codexNativeSchema)) return false
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    if (Array.isArray(node[key]) && !(node[key] as unknown[]).every(codexNativeSchema)) return false
  }
  if (node.items !== undefined && !codexNativeSchema(node.items)) return false
  for (const key of ["$defs", "definitions"]) {
    if (node[key] && !Object.values(node[key] as Record<string, unknown>).every(codexNativeSchema)) return false
  }
  return true
}
