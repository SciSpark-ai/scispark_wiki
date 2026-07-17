/** Bundle ids are vault-relative (`wiki/methods/x`); routes omit that prefix
 * (`/wiki/methods/x`). These two helpers are the ONLY place the mapping
 * lives — every link emitter and the [...id] route go through them. */
export function wikiHref(id: string): string {
  const bare = id.replace(/\.md$/i, "").replace(/^wiki\//, "")
  return `/wiki/${bare}`
}

export function resolveWikiRouteId(joinedParams: string): string {
  const bare = joinedParams.replace(/^wiki\//, "")
  return `wiki/${bare}`
}
