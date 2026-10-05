import { addProjectMember, removeProjectMember } from "@/lib/projects/repository"
import {
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
    return Response.json(await addProjectMember(await getServerVault(), id, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params
    const input = await parseJsonBody(request, membershipSchema)
    return Response.json(await removeProjectMember(await getServerVault(), id, input), { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
