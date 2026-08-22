import { z } from "zod"
import { ChangesetConflictError, ChangesetInvalidError } from "../vault/changesets"
import {
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectValidationError,
} from "./repository"

export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status })
}

export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ProjectValidationError("malformed JSON body")
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ProjectValidationError(z.prettifyError(parsed.error))
  return parsed.data
}

export function projectErrorResponse(error: unknown): Response {
  if (error instanceof ProjectValidationError || error instanceof ChangesetInvalidError) {
    return jsonResponse(400, { error: error.message })
  }
  if (error instanceof ProjectNotFoundError) {
    return jsonResponse(404, { error: error.message })
  }
  if (error instanceof ProjectConflictError || error instanceof ChangesetConflictError) {
    return jsonResponse(409, { error: error.message })
  }
  return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) })
}

export const createProjectSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    instructions: z.string(),
    overview: z.string(),
  })
  .strict()

export const updateProjectSchema = z
  .object({
    revision: z.string(),
    title: z.string(),
    description: z.string(),
    instructions: z.string(),
    overview: z.string(),
  })
  .strict()

export const deleteProjectSchema = z
  .object({
    revision: z.string(),
    previewRevision: z.string(),
  })
  .strict()

export const membershipSchema = z
  .object({
    pageId: z.string(),
    revision: z.string(),
  })
  .strict()

export const createProjectNoteSchema = z
  .object({
    title: z.string(),
    content: z.string(),
    sources: z.array(z.string()),
  })
  .strict()

export const updateProjectNoteSchema = z
  .object({
    revision: z.string(),
    title: z.string(),
    content: z.string(),
  })
  .strict()

export const deleteProjectNoteSchema = z.object({ revision: z.string() }).strict()
