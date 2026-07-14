import { NextResponse } from "next/server"
import { getServerVault } from "@/lib/server/vault"

export async function GET(req: Request): Promise<Response> {
  const prefix = new URL(req.url).searchParams.get("prefix") ?? ""
  const storage = await getServerVault()
  const paths = await storage.list(prefix)
  return NextResponse.json({ paths })
}
