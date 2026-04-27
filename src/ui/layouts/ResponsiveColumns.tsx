import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

type Gap = "2" | "3" | "4" | "6" | "8"

interface ResponsiveColumnsProps extends HTMLAttributes<HTMLDivElement> {
  minWidth?: number
  gap?: Gap
}

const gapClass: Record<Gap, string> = {
  "2": "gap-2",
  "3": "gap-3",
  "4": "gap-4",
  "6": "gap-6",
  "8": "gap-8",
}

export function ResponsiveColumns({ minWidth = 280, gap = "4", className, children, style, ...props }: ResponsiveColumnsProps) {
  return (
    <div
      className={cn("grid", gapClass[gap], className)}
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${minWidth}px, 100%), 1fr))`,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}
