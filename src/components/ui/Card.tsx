import type { HTMLAttributes } from "react"
import { cn } from "./cn"

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-card border border-border-warm bg-light-surface", className)} {...rest} />
}
