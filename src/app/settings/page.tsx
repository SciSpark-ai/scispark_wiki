"use client"

import { ConnectAiCard } from "@/components/settings/ConnectAiCard"
import { CompanionCard } from "@/components/settings/CompanionCard"
import { SpendPanel } from "@/components/settings/SpendPanel"

export default function SettingsPage() {
  return (
    <div className="p-7 max-w-[760px]">
      <h1 className="font-heading text-[28px] text-espresso tracking-heading">Settings</h1>
      <p className="text-[14px] text-muted-text mt-1 mb-6">
        Connect a provider to power SciSpark&apos;s AI features, set a daily spend budget, and tune
        your research companion.
      </p>

      <ConnectAiCard />

      <div className="mt-4">
        <SpendPanel />
      </div>

      <CompanionCard />
    </div>
  )
}
