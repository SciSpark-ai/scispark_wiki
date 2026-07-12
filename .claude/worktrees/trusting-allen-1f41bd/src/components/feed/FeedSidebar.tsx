import { YourWeekWidget } from "./YourWeekWidget";
import { TrendingTopicsWidget } from "./TrendingTopicsWidget";
import { ReadingStreakWidget } from "./ReadingStreakWidget";

export function FeedSidebar() {
  return (
    <div className="space-y-0">
      <YourWeekWidget />
      <hr className="border-border-warm my-4" />
      <TrendingTopicsWidget />
      <hr className="border-border-warm my-4" />
      <ReadingStreakWidget />
    </div>
  );
}
