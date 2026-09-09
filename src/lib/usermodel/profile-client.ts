import type {
  EditableUserProfile,
  UserProfileDetail,
  UserProfileMutation,
} from "./profile"
import type { OnboardingAnswers } from "./pages"

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === "string") return body.error
  } catch {
    // Fall through to the HTTP status.
  }
  return `profile request failed (${response.status})`
}

export async function loadUserProfile(fetchFn: typeof fetch = fetch): Promise<UserProfileDetail | null> {
  const response = await fetchFn("/api/profile")
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await responseError(response))
  const body = (await response.json()) as { profile: UserProfileDetail }
  return body.profile
}

export async function createUserProfileRemote(
  answers: OnboardingAnswers,
  fetchFn: typeof fetch = fetch,
): Promise<UserProfileMutation> {
  const response = await fetchFn("/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(answers),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<UserProfileMutation>
}

export async function updateUserProfileRemote(
  profile: EditableUserProfile & { revision: string },
  fetchFn: typeof fetch = fetch,
): Promise<UserProfileMutation> {
  const response = await fetchFn("/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<UserProfileMutation>
}
