import { NextRequest, NextResponse } from "next/server"
import { handleSearch } from "@/lib/papers/search-core"

export async function GET(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params
  const { searchParams } = req.nextUrl
  const params = {
    q: searchParams.get("q"),
    limit: searchParams.get("limit"),
    from: searchParams.get("from"),
    sort: searchParams.get("sort"),
  }
  const { status, body, headers } = await handleSearch(source, params, { env: process.env })
  return NextResponse.json(body, { status, headers })
}
