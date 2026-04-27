import type { ReactNode } from "react"
import { useBreakpoint } from "../lib/useBreakpoint"
import { cn } from "../primitives/cn"

interface ListDetailProps {
  list: ReactNode
  detail: ReactNode
  detailActive: boolean
  emptyDetail?: ReactNode
  listWidth?: number
}

export function ListDetail({
  list,
  detail,
  detailActive,
  emptyDetail,
  listWidth = 320,
}: ListDetailProps) {
  const breakpoint = useBreakpoint()

  if (breakpoint === "mobile") {
    return (
      <div className="flex flex-col h-full">
        <div className={cn("flex-1", detailActive ? "hidden" : "block")}>
          {list}
        </div>
        <div className={cn("flex-1", detailActive ? "block" : "hidden")}>
          {detail}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full gap-0">
      <div
        className="flex-shrink-0 border-r border-border overflow-y-auto"
        style={{ width: listWidth }}
      >
        {list}
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">
        {detailActive ? detail : (emptyDetail ?? null)}
      </div>
    </div>
  )
}
