import { type ReactNode, useState } from "react"
import { useBreakpoint } from "../lib/useBreakpoint"
import { Sheet, SheetContent } from "../primitives/Sheet"
import { cn } from "../primitives/cn"

interface PanelLayoutProps {
  main: ReactNode
  aside: ReactNode
  asideWidth?: number
  asideTitle?: string
  asideSide?: "left" | "right"
  /** Render prop — receives openAside callback, return the trigger element.
   *  Only rendered on mobile; on desktop the aside is always visible. */
  asideToggle?: (open: () => void) => ReactNode
  className?: string
}

export function PanelLayout({
  main,
  aside,
  asideWidth = 280,
  asideTitle,
  asideSide = "right",
  asideToggle,
  className,
}: PanelLayoutProps) {
  const breakpoint = useBreakpoint()
  const [asideOpen, setAsideOpen] = useState(false)

  if (breakpoint === "desktop") {
    const isLeft = asideSide === "left"
    return (
      <div className={cn("flex h-full", className)}>
        {isLeft && (
          <div
            className="flex-shrink-0 border-r border-border overflow-y-auto"
            style={{ width: asideWidth }}
          >
            {aside}
          </div>
        )}
        <div className="flex-1 min-w-0 overflow-y-auto">{main}</div>
        {!isLeft && (
          <div
            className="flex-shrink-0 border-l border-border overflow-y-auto"
            style={{ width: asideWidth }}
          >
            {aside}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {asideToggle && (
        <div className="flex justify-end px-4 pt-2 pb-1 flex-shrink-0">
          {asideToggle(() => setAsideOpen(true))}
        </div>
      )}
      <div className="flex-1 min-w-0 overflow-y-auto">{main}</div>
      <Sheet open={asideOpen} onOpenChange={setAsideOpen}>
        <SheetContent side={asideSide}>
          {asideTitle && (
            <div className="px-5 pt-5 pb-3 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">{asideTitle}</h2>
            </div>
          )}
          <div className="flex-1 overflow-y-auto">{aside}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
