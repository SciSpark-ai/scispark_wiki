import {
  deleteProject,
  getProject,
  previewDeleteProject,
  updateProject,
} from "@/lib/projects/repository"
import {
  deleteProjectSchema,
  jsonResponse,
  parseJsonBody,
  projectErrorResponse,
  updateProjectSchema,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    return jsonResponse(200, await getProject(await getServerVault(), id))
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, updateProjectSchema)
    return jsonResponse(200, await updateProject(await getServerVault(), id, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const preview = new URL(request.url).searchParams.get("preview")
    if (preview === "true") {
      return jsonResponse(200, { result: await previewDeleteProject(await getServerVault(), id) })
    }
    const input = await parseJsonBody(request, deleteProjectSchema)
    return jsonResponse(200, await deleteProject(await getServerVault(), id, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
