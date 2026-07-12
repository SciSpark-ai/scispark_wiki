import Link from "next/link";

interface EmptyStateProps {
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

export function EmptyState({ message, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[14px] text-muted-text tracking-body">{message}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 text-[14px] text-orange font-medium tracking-body hover:text-orange-light transition-colors"
        >
          {actionLabel} →
        </Link>
      )}
    </div>
  );
}
