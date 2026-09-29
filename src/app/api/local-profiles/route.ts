import { z } from "zod"
import { createLocalProfile, listLocalProfiles } from "@/lib/server/local-profiles"

export const dynamic = "force-dynamic"
const inputSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict()

export async function GET() {
  try { return Response.json({ profiles: await listLocalProfiles() }, { headers: { "Cache-Control": "no-store" } }) }
  catch { return Response.json({ error: "Could not load local profiles. Check that the vault folder is accessible." }, { status: 500 }) }
}

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: "Enter a profile name of 1–80 characters" }, { status: 400 })
  try { return Response.json({ profile: await createLocalProfile(input.data.name) }, { status: 201 }) }
  catch (error) {
    const message = error instanceof Error && error.message.includes("already exists") ? error.message : "Could not create this profile. Check that the vault folder is writable."
    return Response.json({ error: message }, { status: message.includes("already exists") ? 409 : 500 })
  }
}
