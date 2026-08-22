import { createProject, listProjects } from "@/lib/projects/repository"
import {
  createProjectSchema,
  jsonResponse,
  parseJsonBody,
  projectErrorResponse,
} from "@/lib/projects/server-api"
import { getServerVault } from "@/lib/server/vault"

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(200, { projects: await listProjects(await getServerVault()) })
  } catch (error) {
    return projectErrorResponse(error)
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseJsonBody(request, createProjectSchema)
    return jsonResponse(201, await createProject(await getServerVault(), input))
  } catch (error) {
    return projectErrorResponse(error)
  }
}
