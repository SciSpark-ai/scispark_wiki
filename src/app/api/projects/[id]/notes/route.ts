import { createProjectNote, listProjectNotes } from "@/lib/projects/repository"
import {
  createProjectNoteSchema,
  jsonResponse,
  parseJsonBody,
  projectErrorResponse,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    return jsonResponse(200, { notes: await listProjectNotes(await getServerVault(), id) })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, createProjectNoteSchema)
    return jsonResponse(201, await createProjectNote(await getServerVault(), id, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
