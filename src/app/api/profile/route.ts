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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

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
    return jsonResponse(400, { error: error.message })
  }
  if (error instanceof UserProfileNotFoundError) {
    return jsonResponse(404, { error: error.message })
  }
  if (error instanceof UserProfileConflictError || error instanceof ChangesetConflictError) {
    return jsonResponse(409, { error: error.message })
  }
  return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) })
}

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(200, { profile: await getUserProfile(await getServerVault()) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const storage = await getServerVault()
    const input = await parseBody(request, answersSchema)
    return jsonResponse(201, await createUserProfile(storage, input))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const input = await parseBody(request, updateSchema)
    return jsonResponse(200, await updateUserProfile(await getServerVault(), input))
  } catch (error) {
    return errorResponse(error)
  }
}
