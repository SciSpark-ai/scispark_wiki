"use client";

import { ShareButton } from "@/components/shared/ShareButton";

const days = [
  { letter: "M", active: true },
  { letter: "T", active: true },
  { letter: "W", active: true },
  { letter: "T", active: true },
  { letter: "F", active: false },
  { letter: "S", active: false },
  { letter: "S", active: false },
];

export function ReadingStreakWidget() {
  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] text-muted-text font-medium uppercase tracking-[0.08em]">
          Reading Streak
        </p>
        <ShareButton variant="ghost" title="I'm on a 4-day SciSpark reading streak" />
      </div>
      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-[28px] font-bold text-orange leading-none">4</span>
        <span className="text-[13px] text-muted-text tracking-body">day streak</span>
      </div>
      <div className="flex justify-between mb-4">
        {days.map((day, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <span className="text-[12px] font-medium text-muted-text/80 uppercase tracking-[0.05em]">{day.letter}</span>
            <div
              className={`w-5 h-5 rounded-full transition-colors ${
                day.active ? "bg-orange" : "bg-card-surface border border-border-warm/60"
              }`}
            />
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-border-warm/60 space-y-1">
        <p className="text-[12px] text-muted-text tracking-body">
          Best: <span className="font-semibold text-espresso">14 days</span>
        </p>
        <p className="text-[11px] text-orange font-medium">
          10 more to beat your record
        </p>
      </div>
    </div>
  );
}
