"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { useUIStore } from "@/stores/ui-store"

function SettingsRedirect() {
  const router = useRouter()
  const params = useSearchParams()
  const openSettingsModal = useUIStore((s) => s.openSettingsModal)

  useEffect(() => {
    openSettingsModal(params.get("section") ?? "ai")
    router.replace("/")
  }, [openSettingsModal, params, router])

  return null
}

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsRedirect />
    </Suspense>
  )
}
