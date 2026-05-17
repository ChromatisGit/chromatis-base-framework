import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "./cn"
import { useOverlayMounting, useOverlayFocus } from "../lib/useOverlay"

const DIALOG_ANIMATION_MS = 200

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.MutableRefObject<HTMLElement | null>
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog components must be used within <Dialog>.")
  return ctx
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const triggerRef = React.useRef<HTMLElement | null>(null)
  return (
    <DialogContext.Provider value={{ open, setOpen: onOpenChange, triggerRef }}>
      {children}
    </DialogContext.Provider>
  )
}

export function DialogTrigger({
  asChild = false,
  children,
}: {
  asChild?: boolean
  children: React.ReactNode
}) {
  const { setOpen, triggerRef } = useDialogContext()

  const handleOpen = (event?: React.MouseEvent<HTMLElement>) => {
    triggerRef.current = (event?.currentTarget as HTMLElement | null) ?? null
    setOpen(true)
  }

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event)
        if (!event.defaultPrevented) handleOpen(event)
      },
    })
  }

  return <button type="button" onClick={handleOpen}>{children}</button>
}

export function DialogClose({
  asChild = false,
  children,
}: {
  asChild?: boolean
  children: React.ReactNode
}) {
  const { setOpen } = useDialogContext()

  const handleClose = (event?: React.MouseEvent<HTMLElement>) => {
    event?.preventDefault()
    setOpen(false)
  }

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event)
        if (!event.defaultPrevented) handleClose(event)
      },
    })
  }

  return <button type="button" onClick={handleClose}>{children}</button>
}

export function DialogContent({
  className,
  children,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen, triggerRef } = useDialogContext()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const { isMounted, visualState } = useOverlayMounting(open, DIALOG_ANIMATION_MS)
  useOverlayFocus(contentRef, open, setOpen, triggerRef)

  if (!isMounted || typeof document === "undefined") return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        data-state={visualState}
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-[1px]",
          "transition-opacity ease-out",
          "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
        )}
        style={{ transitionDuration: `${DIALOG_ANIMATION_MS}ms` }}
        onClick={() => setOpen(false)}
      />
      <div
        aria-modal="true"
        role="dialog"
        ref={contentRef}
        tabIndex={-1}
        data-state={visualState}
        {...props}
        className={cn(
          "relative z-10 w-full max-w-lg max-h-[90dvh] flex flex-col",
          "bg-card text-foreground rounded-2xl border border-border shadow-2xl outline-none",
          "transition-[transform,opacity] ease-out",
          "data-[state=open]:opacity-100 data-[state=open]:scale-100",
          "data-[state=closed]:opacity-0 data-[state=closed]:scale-95",
          className,
        )}
        style={{
          ...style,
          transitionDuration: `${DIALOG_ANIMATION_MS}ms`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-5 pb-4", className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-end gap-3 px-5 py-4 border-t border-border mt-auto", className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-foreground", className)} {...props} />
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-5 py-2", className)} {...props} />
}
