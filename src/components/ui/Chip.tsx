import type { HTMLAttributes } from "react"
import { cn } from "./cn"

const TONE = {
  neutral: "bg-card-surface text-secondary-dark",
  accent: "bg-orange/10 text-accent-ink",
} as const

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE
}

export function Chip({ tone = "neutral", className, ...rest }: ChipProps) {
  return <span className={cn("inline-block rounded-pill px-2.5 py-0.5 text-[11px] tracking-body", TONE[tone], className)} {...rest} />
}
