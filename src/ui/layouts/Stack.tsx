import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

type Gap = "1" | "2" | "3" | "4" | "6" | "8" | "12"
type Align = "start" | "center" | "end" | "stretch"

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap
  align?: Align
}

const gapClass: Record<Gap, string> = {
  "1": "gap-1",
  "2": "gap-2",
  "3": "gap-3",
  "4": "gap-4",
  "6": "gap-6",
  "8": "gap-8",
  "12": "gap-12",
}

const alignClass: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
}

export function Stack({ gap = "4", align = "stretch", className, children, ...props }: StackProps) {
  return (
    <div
      className={cn("flex flex-col", gapClass[gap], alignClass[align], className)}
      {...props}
    >
      {children}
    </div>
  )
}
