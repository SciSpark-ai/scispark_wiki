import { NextRequest, NextResponse } from "next/server"
import { handleCitations } from "@/lib/papers/citations-core"

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  const { status, body, headers } = await handleCitations({ id }, { apiKey: process.env.S2_API_KEY })
  return NextResponse.json(body, { status, headers })
}
