import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import {
  MUTATION_REQUEST_ERROR,
  mutationRequestRejection,
} from "@/lib/server/mutation-request-security"

/**
 * SciSpark's developer preview is a loopback-only local application. Guard all
 * present and future mutating API routes at the shared request boundary.
 */
export function proxy(request: NextRequest): NextResponse {
  const rejection = mutationRequestRejection(request)
  if (rejection !== null) {
    return NextResponse.json({ error: MUTATION_REQUEST_ERROR }, { status: 403 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: "/api/:path*",
}
