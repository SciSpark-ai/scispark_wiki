"use client";

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
      <p className="text-[11px] text-muted-text font-medium uppercase tracking-[0.08em] mb-3">
        Reading Streak
      </p>
      <div className="flex items-baseline gap-1.5 mb-3">
        <span className="text-[22px] font-bold text-orange leading-none">4</span>
        <span className="text-[13px] text-muted-text tracking-body">day streak</span>
      </div>
      <div className="flex gap-3">
        {days.map((day, index) => (
          <div key={index} className="flex flex-col items-center gap-1.5">
            <span className="text-[10px] text-muted-text/70 uppercase">{day.letter}</span>
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                day.active ? "bg-orange" : "bg-card-surface"
              }`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
