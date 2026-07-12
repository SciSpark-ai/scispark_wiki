"use client";

const topics = [
  { rank: 1, name: "Psychedelic Therapy", count: 52 },
  { rank: 2, name: "Deep Brain Stimulation", count: 38 },
  { rank: 3, name: "Ketamine/Esketamine", count: 31 },
  { rank: 4, name: "Gut-Brain Axis", count: 24 },
  { rank: 5, name: "Digital Phenotyping", count: 19 },
];

export function TrendingTopicsWidget() {
  const maxCount = Math.max(...topics.map((t) => t.count));

  return (
    <div>
      <p className="text-[11px] text-muted-text font-medium uppercase tracking-[0.08em] mb-3">
        Trending Topics
      </p>
      <div className="space-y-1.5">
        {topics.map((topic) => (
          <div
            key={topic.rank}
            className="flex items-center gap-3 py-1 rounded-[6px] hover:bg-card-surface/40 px-1 -mx-1 transition-colors cursor-pointer"
          >
            <span
              className={`text-[11px] font-semibold w-4 text-right tabular-nums flex-shrink-0 ${
                topic.rank <= 2 ? "text-orange" : "text-muted-text/60"
              }`}
            >
              {topic.rank}
            </span>
            <p className="text-[13px] text-espresso flex-shrink-0 truncate tracking-body w-[180px]">
              {topic.name}
            </p>
            <div className="flex-1 h-1.5 rounded-full bg-orange/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-orange/60"
                style={{ width: `${(topic.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-text tabular-nums flex-shrink-0 w-8 text-right">
              {topic.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
