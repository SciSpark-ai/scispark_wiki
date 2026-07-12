import { NextRequest, NextResponse } from "next/server"
import { handleResolve } from "@/lib/papers/resolve-core"

export async function GET(req: NextRequest) {
  const doi = req.nextUrl.searchParams.get("doi")
  const { status, body, headers } = await handleResolve(doi, { email: process.env.UNPAYWALL_EMAIL })
  return NextResponse.json(body, { status, headers })
}
