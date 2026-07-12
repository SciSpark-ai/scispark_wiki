import { NextRequest } from "next/server"
import { handleFetchRelay } from "@/lib/server/fetch-relay"

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url")
  const forwardedFor = req.headers.get("x-forwarded-for") ?? ""
  const clientKey = forwardedFor.split(",")[0]?.trim() || "local"
  return handleFetchRelay(url, clientKey)
}
