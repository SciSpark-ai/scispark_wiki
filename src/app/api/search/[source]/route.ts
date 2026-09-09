import { NextRequest, NextResponse } from "next/server"
import { handleSearch } from "@/lib/papers/search-core"
import { getServerS2Key } from "@/lib/server/paper-source-settings"
import { getServerVault } from "@/lib/server/vault"
import { readEnabledPaperSources } from "@/lib/papers/source-preferences"
import { PAPER_SOURCE_IDS } from "@/lib/papers/source-settings-types"
import type { SourceId } from "@/lib/papers/types"

export async function GET(req: NextRequest, ctx: { params: Promise<{ source: string }> }) {
  const { source } = await ctx.params
  if ((PAPER_SOURCE_IDS as readonly string[]).includes(source)) {
    try {
      if (!(await readEnabledPaperSources(await getServerVault())).includes(source as SourceId)) {
        return NextResponse.json({ error: "This source is disabled. Enable it in Settings → Paper sources." }, { status: 403, headers: { "Cache-Control": "no-store" } })
      }
    } catch {
      return NextResponse.json({ error: "Could not load your paper sources." }, { status: 500, headers: { "Cache-Control": "no-store" } })
    }
  }
  const { searchParams } = req.nextUrl
  const params = {
    q: searchParams.get("q"),
    limit: searchParams.get("limit"),
    from: searchParams.get("from"),
    sort: searchParams.get("sort"),
  }
  const env = source === "s2" ? { ...process.env, S2_API_KEY: await getServerS2Key() } : process.env
  const { status, body, headers } = await handleSearch(source, params, { env })
  return NextResponse.json(body, { status, headers })
}
