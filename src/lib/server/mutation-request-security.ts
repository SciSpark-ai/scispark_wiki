const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"])

export const MUTATION_REQUEST_ERROR =
  "Mutating APIs are available only from the loopback SciSpark app origin."

function parseHost(value: string | null): URL | null {
  if (value === null || value.length === 0 || value !== value.trim() || value.includes(",")) {
    return null
  }

  try {
    const parsed = new URL(`http://${value}`)
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isLoopbackHost(host: URL): boolean {
  return LOOPBACK_HOSTNAMES.has(host.hostname.toLowerCase())
}

/**
 * Checks the local developer-preview network boundary for an API request.
 *
 * The app intentionally has no accounts or remote-auth layer: it is a
 * loopback-only process that owns the user's vault and provider keys. Host is
 * therefore always required and must name loopback. Browsers also send Origin
 * and Sec-Fetch-Site on cross-origin mutations; when either signal is present,
 * it must describe the exact app origin. Origin-less local CLI requests remain
 * usable, but still have to address the loopback Host.
 */
export function mutationRequestRejection(request: Request): string | null {
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return null

  const host = parseHost(request.headers.get("host"))
  if (host === null || !isLoopbackHost(host)) return MUTATION_REQUEST_ERROR

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none") {
    return MUTATION_REQUEST_ERROR
  }

  const originValue = request.headers.get("origin")
  if (originValue === null) return null

  try {
    const origin = new URL(originValue)
    const requestUrl = new URL(request.url)
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username !== "" ||
      origin.password !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== "" ||
      !isLoopbackHost(origin) ||
      origin.host.toLowerCase() !== host.host.toLowerCase() ||
      origin.protocol !== requestUrl.protocol
    ) {
      return MUTATION_REQUEST_ERROR
    }
  } catch {
    return MUTATION_REQUEST_ERROR
  }

  return null
}
