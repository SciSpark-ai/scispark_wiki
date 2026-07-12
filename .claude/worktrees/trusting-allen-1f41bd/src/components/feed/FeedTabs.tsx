"use client";

import type { FeedTab } from "@/hooks/useFeed";

interface FeedTabsProps {
  activeTab: FeedTab;
  onTabChange: (tab: FeedTab) => void;
  specialties: string[];
  specialtyFilter: string | null;
  onSpecialtyChange: (specialty: string | null) => void;
}

export function FeedTabs({
  activeTab,
  onTabChange,
  specialties,
  specialtyFilter,
  onSpecialtyChange,
}: FeedTabsProps) {
  const tabs: { label: string; value: FeedTab }[] = [
    { label: "For You", value: "for-you" },
    { label: "Trending", value: "trending" },
    { label: "By Specialty", value: "by-specialty" },
  ];

  return (
    <div>
      <div className="flex gap-6 border-b border-border-warm/30">
        {tabs.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onTabChange(value)}
            className={`pb-2 px-1 text-[14px] tracking-body border-b-2 transition-colors ${
              activeTab === value
                ? "text-espresso font-medium border-orange"
                : "text-muted-text border-transparent hover:text-espresso"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "by-specialty" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {specialties.map((specialty) => (
            <button
              key={specialty}
              onClick={() =>
                onSpecialtyChange(specialtyFilter === specialty ? null : specialty)
              }
              className={`px-3 py-1 rounded-pill text-[13px] border transition-colors ${
                specialtyFilter === specialty
                  ? "bg-orange text-white border-orange"
                  : "bg-light-surface text-muted-text border-border-warm hover:bg-card-surface"
              }`}
            >
              {specialty}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
