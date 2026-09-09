import { NextRequest, NextResponse } from "next/server"
import { handleCitations } from "@/lib/papers/citations-core"
import { getServerS2Key } from "@/lib/server/paper-source-settings"

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")
  const { status, body, headers } = await handleCitations({ id }, { apiKey: await getServerS2Key() })
  return NextResponse.json(body, { status, headers })
}
