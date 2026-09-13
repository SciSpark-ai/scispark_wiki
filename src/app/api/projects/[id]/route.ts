import {
  deleteProject,
  getProject,
  previewDeleteProject,
  updateProject,
} from "@/lib/projects/repository"
import {
  deleteProjectSchema,
  parseJsonBody,
  projectErrorResponse,
  updateProjectSchema,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    return Response.json(await getProject(await getServerVault(), id), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, updateProjectSchema)
    return Response.json(await updateProject(await getServerVault(), id, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const preview = new URL(request.url).searchParams.get("preview")
    if (preview === "true") {
      return Response.json({ result: await previewDeleteProject(await getServerVault(), id) }, { status: 200 })
    }
    const input = await parseJsonBody(request, deleteProjectSchema)
    return Response.json(await deleteProject(await getServerVault(), id, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
