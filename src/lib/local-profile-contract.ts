/** Safe public metadata. Provider settings and research stay inside the vault. */
export interface LocalProfile {
  id: string
  name: string
  vaultPath: string
}

export const PROFILE_HEADER = "x-scispark-profile"
export const PROFILE_COOKIE = "scispark-session"
export const PROFILE_SESSION_SECONDS = 30 * 24 * 60 * 60
