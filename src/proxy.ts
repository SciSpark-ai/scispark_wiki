import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { getProfileSession } from "@/lib/server/local-profiles"
import { PROFILE_COOKIE, PROFILE_HEADER } from "@/lib/local-profile-contract"
import {
  MUTATION_REQUEST_ERROR,
  mutationRequestRejection,
} from "@/lib/server/mutation-request-security"

/**
 * SciSpark's developer preview is a loopback-only local application. Guard all
 * present and future mutating API routes at the shared request boundary.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const rejection = mutationRequestRejection(request)
  if (rejection !== null) {
    return NextResponse.json({ error: MUTATION_REQUEST_ERROR }, { status: 403 })
  }
  const path = request.nextUrl.pathname
  // The public relay contains no vault data; HTML reader figures use <img> requests.
  const publicRoute = path === "/api/local-profiles" || path === "/api/local-profiles/session" || (path === "/api/fetch" && request.method === "GET")
  if (!publicRoute) {
    const profile = await getProfileSession(request.cookies.get(PROFILE_COOKIE)?.value)
    // Native downloads bind their destination in the URL; fetches use a header.
    const expected = request.headers.get(PROFILE_HEADER) ?? (request.method === "GET" ? request.nextUrl.searchParams.get("scisparkProfile") : null)
    if (!profile || expected !== profile.id) {
      return NextResponse.json({ error: "Open your local profile to continue. The profile may have changed in another tab." }, {
        status: profile ? 409 : 401,
        headers: { "x-scispark-session-expired": "1", "Cache-Control": "no-store" },
      })
    }
  }
  const response = NextResponse.next()
  response.headers.set("Cache-Control", "no-store")
  return response
}

export const config = {
  matcher: "/api/:path*",
}
