import { addProjectMember, removeProjectMember } from "@/lib/projects/repository"
import {
  jsonResponse,
  membershipSchema,
  parseJsonBody,
  projectErrorResponse,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, membershipSchema)
    return jsonResponse(200, await addProjectMember(await getServerVault(), id, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, membershipSchema)
    return jsonResponse(200, await removeProjectMember(await getServerVault(), id, input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
