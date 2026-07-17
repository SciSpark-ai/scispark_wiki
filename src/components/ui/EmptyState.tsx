import type { ReactNode } from "react"

export interface EmptyStateProps {
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="rounded-card border border-dashed border-border-warm px-6 py-10 text-center">
      <div className="text-[14px] text-espresso">{title}</div>
      {hint && <div className="mt-1 text-[12px] text-muted-text">{hint}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}
