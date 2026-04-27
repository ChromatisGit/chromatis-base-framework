import { type ReactNode } from "react"
import { cn } from "../primitives/cn"

interface MetadataItem {
  label: string
  value: ReactNode
}

interface MetadataListProps {
  items: MetadataItem[]
  columns?: 1 | 2
  className?: string
}

export function MetadataList({ items, columns = 1, className }: MetadataListProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 2 ? "grid-cols-2" : "grid-cols-1",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5 min-w-0">
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {item.label}
          </dt>
          <dd className="text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
