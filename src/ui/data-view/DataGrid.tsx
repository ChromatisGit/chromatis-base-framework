import { type HTMLAttributes } from "react"
import { ResponsiveColumns } from "../layouts/ResponsiveColumns"

type Gap = "2" | "3" | "4" | "6" | "8"

interface DataGridProps extends HTMLAttributes<HTMLDivElement> {
  minWidth?: number
  gap?: Gap
}

export function DataGrid({ minWidth = 300, gap = "4", ...props }: DataGridProps) {
  return <ResponsiveColumns minWidth={minWidth} gap={gap} {...props} />
}
