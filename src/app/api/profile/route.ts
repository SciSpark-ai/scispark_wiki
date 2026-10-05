import { z } from "zod"
import { RecommendationPreferencesSchema } from "@/lib/recommendation/contract"
import {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  UserProfileConflictError,
  UserProfileNotFoundError,
  UserProfileValidationError,
} from "@/lib/usermodel/profile"
import { getServerVault } from "@/lib/server/vault"
import { ChangesetConflictError, ChangesetInvalidError } from "@/lib/vault/changesets"

const answersSchema = z.object({
  name: z.string(),
  role: z.string(),
  fields: z.string(),
  topics: z.string(),
  feedPrefs: z.string(),
  recommendations: RecommendationPreferencesSchema.optional(),
}).strict()

const updateSchema = answersSchema.extend({
  revision: z.string(),
  avatarDataUrl: z.string().nullable(),
}).strict()

async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new UserProfileValidationError("malformed JSON body")
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new UserProfileValidationError("invalid profile request")
  return parsed.data
}

function errorResponse(error: unknown): Response {
  if (error instanceof UserProfileValidationError || error instanceof ChangesetInvalidError) {
    return Response.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof UserProfileNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof UserProfileConflictError || error instanceof ChangesetConflictError) {
    return Response.json({ error: error.message }, { status: 409 })
  }
  return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
}

export async function GET(): Promise<Response> {
  try {
    return Response.json({ profile: await getUserProfile(await getServerVault()) }, { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const storage = await getServerVault()
    const input = await parseBody(request, answersSchema)
    return Response.json(await createUserProfile(storage, input), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const input = await parseBody(request, updateSchema)
    return Response.json(await updateUserProfile(await getServerVault(), input), { status: 200 })
  } catch (error) {
    return errorResponse(error)
  }
}
