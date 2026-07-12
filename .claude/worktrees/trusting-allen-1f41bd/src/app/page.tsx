"use client";

import { useState, useEffect } from "react";
import { useFeed } from "@/hooks/useFeed";
import { useUserStore } from "@/stores/user-store";
import { FeedTabs } from "@/components/feed/FeedTabs";
import { FeedCard } from "@/components/feed/FeedCard";
import { FeedSidebar } from "@/components/feed/FeedSidebar";
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

  // Hydration-safe greeting
  useEffect(() => {
    setGreeting(getGreeting());
  }, []);

  return (
    <div className="h-full flex flex-col pt-7 px-7">
      {/* Fixed: Greeting */}
      <h1 className="font-heading text-[32px] text-espresso tracking-heading flex-shrink-0">
        {greeting}, <span className="text-orange">{user?.name ?? "there"}</span>
      </h1>

      {/* Fixed: Tabs */}
      <div className="mt-4 flex-shrink-0">
        <FeedTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          specialties={specialties}
          specialtyFilter={specialtyFilter}
          onSpecialtyChange={setSpecialtyFilter}
        />
      </div>

      {/* Scrollable cards + fixed widgets */}
      <div className="flex gap-8 mt-6 flex-1 min-h-0">
        {/* Scrollable card grid */}
        <div className="flex-1 min-w-0 overflow-y-auto pb-7">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-[14px]">
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

        {/* Fixed widgets — never scrolls */}
        <div className="hidden lg:block w-[220px] flex-shrink-0">
          <FeedSidebar />
        </div>
      </div>
    </div>
  );
}
