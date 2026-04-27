import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end" | "center" | "between"
}

const alignClass = {
  start: "justify-start",
  end: "justify-end",
  center: "justify-center",
  between: "justify-between",
}

export function ActionBar({ align = "start", className, children, ...props }: ActionBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto scrollbar-none",
        alignClass[align],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
