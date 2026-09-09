import { readNdjson } from "../server/ndjson"
import { errorMessageFor } from "../llm/settings-client"
import type { OnboardingInput, OnboardingState } from "./contract"
import type { UserProfileDetail } from "../usermodel/profile"
import type { MutationWarning } from "../vault/mutations"

export async function loadOnboarding(): Promise<OnboardingState> {
  const response = await fetch("/api/onboarding", { cache: "no-store" })
  if (!response.ok) throw new Error(await errorMessageFor(response))
  return response.json()
}
export async function sendOnboarding(input: OnboardingInput, onText?: (text: string) => void): Promise<{
  state: OnboardingState; profile?: UserProfileDetail; warnings: MutationWarning[]
}> {
  const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify(input) })
  if (!response.ok) throw new Error(await errorMessageFor(response))
  if (input.action === "confirm") return response.json()
  return await readNdjson(response, (event) => {
    if (event.type === "text" && typeof event.draft === "string") onText?.(event.draft)
  }) as Awaited<ReturnType<typeof sendOnboarding>>
}
