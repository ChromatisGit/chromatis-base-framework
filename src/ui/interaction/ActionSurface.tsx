import { type ButtonHTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface ActionSurfaceProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  rounded?: "sm" | "md" | "lg" | "xl" | "2xl" | "full"
}

const roundedClass = {
  sm: "rounded-lg",
  md: "rounded-xl",
  lg: "rounded-2xl",
  xl: "rounded-3xl",
  "2xl": "rounded-[2rem]",
  full: "rounded-full",
}

export function ActionSurface({ rounded = "xl", className, children, ...props }: ActionSurfaceProps) {
  return (
    <button
      type="button"
      className={cn(
        "w-full text-left transition-all cursor-pointer outline-none",
        "hover:bg-muted/60 active:scale-[0.99] active:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring",
        roundedClass[rounded],
        props.disabled && "opacity-50 cursor-not-allowed active:scale-100",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
