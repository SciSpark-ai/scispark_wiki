import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createProfileSession, getProfileSession, revokeProfileSession } from "@/lib/server/local-profiles"
import { openServerVault } from "@/lib/server/vault"
import { recoverReviewJobs } from "@/lib/review/coordinator"
import { PROFILE_COOKIE, PROFILE_HEADER, PROFILE_SESSION_SECONDS } from "@/lib/local-profile-contract"

export const dynamic = "force-dynamic"
const inputSchema = z.object({ profileId: z.string().min(1).max(100) }).strict()
const cookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/" }

export async function GET(request: NextRequest) {
  const profile = await getProfileSession(request.cookies.get(PROFILE_COOKIE)?.value)
  return NextResponse.json({ profile }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest) {
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return NextResponse.json({ error: "Choose a local profile" }, { status: 400 })
  try {
    const { token, profile } = await createProfileSession(input.data.profileId)
    // Recovery records interrupted runs; it never resumes paid work.
    await recoverReviewJobs(await openServerVault(profile.vaultPath))
    await revokeProfileSession(request.cookies.get(PROFILE_COOKIE)?.value)
    const response = NextResponse.json({ profile })
    response.cookies.set(PROFILE_COOKIE, token, { ...cookieOptions, maxAge: PROFILE_SESSION_SECONDS, secure: request.nextUrl.protocol === "https:" })
    return response
  } catch {
    return NextResponse.json({ error: "Could not open this profile. Please try again." }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const token = request.cookies.get(PROFILE_COOKIE)?.value
  const profile = await getProfileSession(token)
  if (profile && request.headers.get(PROFILE_HEADER) !== profile.id) {
    return NextResponse.json({ error: "The profile changed in another tab. Reload to continue." }, { status: 409, headers: { "x-scispark-session-expired": "1" } })
  }
  await revokeProfileSession(token)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(PROFILE_COOKIE, "", { ...cookieOptions, maxAge: 0 })
  return response
}
