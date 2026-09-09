import { getServerVault } from "@/lib/server/vault"
import { mutationRequestRejection } from "@/lib/server/mutation-request-security"
import { ndjsonSkillRoute, getSkillTestOverrides } from "@/lib/server/skill-route"
import { InputSchema } from "@/lib/onboarding/contract"
import { advanceOnboarding, getOnboardingState, OnboardingError } from "@/lib/onboarding/service"
import { ChangesetConflictError } from "@/lib/vault/changesets"
import { UserProfileConflictError, UserProfileValidationError } from "@/lib/usermodel/profile"

function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Onboarding could not be opened" },
    { status: error instanceof OnboardingError ? error.status
      : error instanceof ChangesetConflictError || error instanceof UserProfileConflictError ? 409
      : error instanceof UserProfileValidationError ? 400 : 500 })
}
export async function GET() {
  try { return Response.json(await getOnboardingState(await getServerVault()), { headers: { "cache-control": "no-store" } }) }
  catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  const rejection = mutationRequestRejection(request)
  if (rejection) return Response.json({ error: rejection }, { status: 403 })
  const parsed = InputSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid onboarding request" }, { status: 400 })
  const input = parsed.data
  const overrides = getSkillTestOverrides()
  if (input.action === "confirm") {
    try { return Response.json(await advanceOnboarding(await getServerVault(), input, overrides)) }
    catch (error) { return failure(error) }
  }
  // The validated input is captured here; no second read of the consumed body.
  return ndjsonSkillRoute(async (_unused, storage, emit) => advanceOnboarding(storage, input, {
    ...overrides, onText: (draft) => emit({ type: "text", draft }),
  }))(new Request(request.url, { method: "POST", headers: request.headers, body: "{}" }))
}
