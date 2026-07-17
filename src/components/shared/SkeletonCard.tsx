export function SkeletonCard() {
  return (
    <div className="bg-light-surface rounded-card border border-border-warm overflow-hidden animate-pulse">
      <div className="h-[30px] bg-card-surface" />
      <div className="p-4 space-y-3">
        <div className="h-4 bg-card-surface rounded w-3/4" />
        <div className="h-4 bg-card-surface rounded w-1/2" />
        <div className="h-3 bg-card-surface rounded w-full" />
        <div className="h-3 bg-card-surface rounded w-2/3" />
      </div>
      <div className="px-4 pb-3 flex justify-between">
        <div className="h-3 bg-card-surface rounded w-20" />
        <div className="h-3 bg-card-surface rounded w-16" />
      </div>
    </div>
  );
}
