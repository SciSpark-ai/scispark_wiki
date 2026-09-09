"use client"

import { useEffect } from "react"
import { loadUserProfile } from "@/lib/usermodel/profile-client"
import { useUserStore } from "@/stores/user-store"

/** Hydrates the shell's local identity from the vault once per browser load. */
export function UserIdentityHydrator() {
  useEffect(() => {
    let cancelled = false
    void loadUserProfile()
      .then((profile) => {
        if (cancelled) return
        useUserStore.getState().setOnboardingComplete(profile !== null)
        useUserStore.getState().setUser(
          profile
            ? { name: profile.name, avatar: profile.avatarDataUrl ?? undefined }
            : null,
        )
      })
      .catch(() => {
        if (!cancelled) useUserStore.getState().setUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return null
}
