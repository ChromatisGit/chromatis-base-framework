import type { ReactNode } from "react"
import { cn } from "../primitives/cn"

interface FormActionsProps {
  children: ReactNode
  align?: "start" | "end"
  className?: string
}

export function FormActions({ children, align = "end", className }: FormActionsProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex items-center gap-3 pt-4 pb-4 border-t border-border",
        "bg-background/95 backdrop-blur-sm -mx-4 px-4",
        "md:static md:bg-transparent md:backdrop-blur-none md:border-none md:-mx-0 md:px-0 md:pb-0",
        align === "end" ? "justify-end" : "justify-start",
        className
      )}
    >
      {children}
    </div>
  )
}
