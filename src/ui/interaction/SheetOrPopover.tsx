import { type ReactNode, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useBreakpoint } from "../lib/useBreakpoint"
import { Sheet, SheetContent } from "../primitives/Sheet"
import { cn } from "../primitives/cn"

interface SheetOrPopoverProps {
  trigger: ReactNode
  children: ReactNode
  sheetTitle?: string
  align?: "start" | "end"
  className?: string
}

export function SheetOrPopover({
  trigger,
  children,
  sheetTitle,
  align = "end",
  className,
}: SheetOrPopoverProps) {
  const [open, setOpen] = useState(false)
  const breakpoint = useBreakpoint()
  const triggerRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (open && breakpoint === "desktop" && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const above = spaceBelow < 200

      setPopoverStyle({
        position: "fixed",
        top: above ? undefined : rect.bottom + 6,
        bottom: above ? window.innerHeight - rect.top + 6 : undefined,
        ...(align === "end"
          ? { right: window.innerWidth - rect.right }
          : { left: rect.left }),
        zIndex: 60,
        minWidth: Math.max(rect.width, 180),
      })
    }
  }, [open, breakpoint, align])

  useEffect(() => {
    if (!open || breakpoint !== "desktop") return
    function onPointerDown(e: PointerEvent) {
      if (triggerRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, breakpoint])

  if (breakpoint === "mobile") {
    return (
      <>
        <div ref={triggerRef} onClick={() => setOpen(true)} style={{ display: "contents" }}>
          {trigger}
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom">
            {sheetTitle && (
              <div className="px-5 pt-5 pb-3 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">{sheetTitle}</h2>
              </div>
            )}
            <div className="overflow-y-auto p-4">{children}</div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)} style={{ display: "contents" }}>
        {trigger}
      </div>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={popoverStyle}
            className={cn(
              "bg-card border border-border rounded-2xl shadow-lg overflow-hidden",
              className,
            )}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  )
}
