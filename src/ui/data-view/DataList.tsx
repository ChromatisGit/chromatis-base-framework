import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface DataListProps extends HTMLAttributes<HTMLDivElement> {
  flush?: boolean
}

export function DataList({ flush = false, className, children, ...props }: DataListProps) {
  return (
    <div
      className={cn(
        "divide-y divide-border overflow-hidden",
        flush ? "" : "bg-card rounded-2xl border border-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
