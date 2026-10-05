import { deleteProjectNote, updateProjectNote } from "@/lib/projects/repository"
import {
  deleteProjectNoteSchema,
  parseJsonBody,
  projectErrorResponse,
  updateProjectNoteSchema,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string; noteId: string }> }

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, noteId } = await context.params
    const input = await parseJsonBody(request, updateProjectNoteSchema)
    return Response.json(await updateProjectNote(await getServerVault(), id, noteId, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, noteId } = await context.params
    const input = await parseJsonBody(request, deleteProjectNoteSchema)
    return Response.json(await deleteProjectNote(await getServerVault(), id, noteId, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
