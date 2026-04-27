import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

type Gap = "1" | "2" | "3" | "4" | "6" | "8"
type Align = "start" | "center" | "end" | "baseline"

interface InlineProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap
  align?: Align
  wrap?: boolean
}

const gapClass: Record<Gap, string> = {
  "1": "gap-1",
  "2": "gap-2",
  "3": "gap-3",
  "4": "gap-4",
  "6": "gap-6",
  "8": "gap-8",
}

const alignClass: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  baseline: "items-baseline",
}

export function Inline({ gap = "3", align = "center", wrap = true, className, children, ...props }: InlineProps) {
  return (
    <div
      className={cn(
        "flex",
        wrap ? "flex-wrap" : "flex-nowrap",
        gapClass[gap],
        alignClass[align],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
