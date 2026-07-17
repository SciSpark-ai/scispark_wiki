import type { ButtonHTMLAttributes } from "react"
import { cn } from "./cn"

type Variant = "primary" | "secondary" | "quiet"
type Size = "sm" | "md"

const VARIANT: Record<Variant, string> = {
  primary: "text-white bg-orange hover:bg-orange/90 font-medium",
  secondary: "text-espresso border border-border-warm hover:bg-card-surface",
  quiet: "text-muted-text hover:text-espresso",
}
const SIZE: Record<Size, string> = {
  sm: "text-[12px] px-3 py-1",
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
      className={cn("rounded-pill transition-colors disabled:opacity-50", VARIANT[variant], SIZE[size], className)}
      {...rest}
    />
  )
}
