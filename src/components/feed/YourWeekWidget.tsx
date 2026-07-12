"use client";

import { FileText, TrendingUp, Bookmark } from "lucide-react";
import { ShareButton } from "@/components/shared/ShareButton";

const stats = [
  { icon: FileText, value: 18, label: "new in your interests" },
  { icon: TrendingUp, value: 5, label: "trending in your fields" },
  { icon: Bookmark, value: 2, label: "saved & unread" },
];

export function YourWeekWidget() {
  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] text-muted-text font-medium uppercase tracking-[0.08em]">
          Your Week
        </p>
        <ShareButton variant="ghost" title="My SciSpark week in research" />
      </div>

      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-bold text-espresso leading-none">25</span>
          <span className="text-[12px] text-muted-text tracking-body">papers this week</span>
        </div>
        <p className="text-[11px] text-orange font-medium mt-1.5">+3 vs last week</p>
      </div>

      <div className="space-y-2.5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-[7px] bg-orange/10 flex items-center justify-center flex-shrink-0">
                <Icon size={13} className="text-orange" />
              </div>
              <p className="text-[13px] tracking-body">
                <span className="font-semibold text-espresso">{stat.value}</span>
                <span className="text-muted-text ml-1">{stat.label}</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
