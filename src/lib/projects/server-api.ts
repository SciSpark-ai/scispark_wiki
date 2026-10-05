import { z } from "zod"
import { ChangesetConflictError, ChangesetInvalidError } from "../vault/changesets"
import {
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectValidationError,
} from "./repository"

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
    return Response.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof ProjectNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof ProjectConflictError || error instanceof ChangesetConflictError) {
    return Response.json({ error: error.message }, { status: 409 })
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
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
