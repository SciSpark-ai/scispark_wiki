import { createProjectNote, listProjectNotes } from "@/lib/projects/repository"
import {
  createProjectNoteSchema,
  parseJsonBody,
  projectErrorResponse,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    return Response.json({ notes: await listProjectNotes(await getServerVault(), id) }, { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, createProjectNoteSchema)
    return Response.json(await createProjectNote(await getServerVault(), id, input), { status: 201 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
