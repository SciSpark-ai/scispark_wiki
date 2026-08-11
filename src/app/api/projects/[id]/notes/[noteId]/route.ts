import { deleteProjectNote, updateProjectNote } from "@/lib/projects/repository"
import {
  deleteProjectNoteSchema,
  jsonResponse,
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
    return jsonResponse(200, await updateProjectNote(await getServerVault(), id, noteId, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id, noteId } = await context.params
    const input = await parseJsonBody(request, deleteProjectNoteSchema)
    return jsonResponse(200, await deleteProjectNote(await getServerVault(), id, noteId, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
