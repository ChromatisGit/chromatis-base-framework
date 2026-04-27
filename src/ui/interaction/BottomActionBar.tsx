import { type ReactNode } from "react"
import { cn } from "../primitives/cn"

interface BottomActionBarProps {
  children: ReactNode
  className?: string
}

export function BottomActionBar({ children, className }: BottomActionBarProps) {
  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30",
        "flex items-center gap-3 px-4 pt-3 bg-card border-t border-border",
        "md:hidden",
        className,
      )}
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  )
}
