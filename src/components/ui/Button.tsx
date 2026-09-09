import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn"

type Variant = "primary" | "secondary" | "quiet"
type Size = "sm" | "md"

const VARIANT: Record<Variant, string> = {
  primary: "text-on-accent bg-orange hover:bg-orange/90 font-medium",
  secondary: "text-espresso border border-border-warm hover:bg-card-surface",
  quiet: "text-muted-text hover:text-espresso",
}
const SIZE: Record<Size, string> = {
  sm: "text-[13px] px-3 py-1", // compact padding, same type size as md
  md: "text-[13px] px-4 py-1.5",
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("rounded-pill transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 focus-visible:ring-offset-page-bg", VARIANT[variant], SIZE[size], className)}
      {...rest}
    />
  )
}
