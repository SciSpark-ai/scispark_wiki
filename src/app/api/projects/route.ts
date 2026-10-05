import { createProject, listProjects } from "@/lib/projects/repository"
import {
  createProjectSchema,
  parseJsonBody,
  projectErrorResponse,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

export async function GET(): Promise<Response> {
  try {
    return Response.json({ projects: await listProjects(await getServerVault()) }, { status: 200 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseJsonBody(request, createProjectSchema)
    return Response.json(await createProject(await getServerVault(), input), { status: 201 })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
