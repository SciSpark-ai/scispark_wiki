"use client";

import { useState, useEffect } from "react";
import { useFeed } from "@/hooks/useFeed";
import { useUserStore } from "@/stores/user-store";
import { FeedTabs } from "@/components/feed/FeedTabs";
import { FeedCard } from "@/components/feed/FeedCard";
import { YourWeekWidget } from "@/components/feed/YourWeekWidget";
import { TrendingTopicsWidget } from "@/components/feed/TrendingTopicsWidget";
import { ReadingStreakWidget } from "@/components/feed/ReadingStreakWidget";
import { SkeletonCard } from "@/components/shared/SkeletonCard";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomePage() {
  const user = useUserStore((s) => s.user);

  const {
    papers,
    isLoading,
    activeTab,
    setActiveTab,
    specialtyFilter,
    setSpecialtyFilter,
    specialties,
    toggleAction,
  } = useFeed();

  const [greeting, setGreeting] = useState("Welcome back");

  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

  return (
    <div className="pb-10">
      <div className="sticky top-0 z-10 bg-page-bg border-b border-border-warm/60 px-7 py-2.5">
        <FeedTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          specialties={specialties}
          specialtyFilter={specialtyFilter}
          onSpecialtyChange={setSpecialtyFilter}
        />
      </div>

      <div className="px-7">
        <h1 className="font-heading text-[32px] text-espresso tracking-heading pt-7">
          {greeting}, <span className="text-orange">{user?.name ?? "there"}</span>
        </h1>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-[18px] bg-white/70 border border-border-warm/60 p-5">
            <YourWeekWidget />
          </div>
          <div className="rounded-[18px] bg-white/70 border border-border-warm/60 p-5 md:col-span-2">
            <TrendingTopicsWidget />
          </div>
          <div className="rounded-[18px] bg-white/70 border border-border-warm/60 p-5">
            <ReadingStreakWidget />
          </div>
        </div>

        <h2 className="mt-10 font-heading text-[22px] text-espresso tracking-heading flex items-center gap-2 cursor-pointer hover:text-orange transition-colors group">
          New research
          <span className="text-orange transition-transform group-hover:translate-x-1">→</span>
        </h2>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-[14px]">
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : papers.length === 0 ? (
            <p className="col-span-full text-[15px] text-muted-text tracking-body py-12 text-center">
              No papers match your filters.
            </p>
          ) : (
            papers.map((paper) => (
              <FeedCard
                key={paper.id}
                paper={paper}
                onToggleAction={toggleAction}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
