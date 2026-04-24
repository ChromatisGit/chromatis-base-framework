import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "./cn.js";

type SheetSide = "top" | "right" | "bottom" | "left";
const SHEET_ANIMATION_MS = 420;

function getSheetTransform(side: SheetSide, visualState: "open" | "closed") {
  if (visualState === "open") return "translate3d(0, 0, 0)";

  switch (side) {
    case "bottom":
      return "translate3d(0, 100%, 0)";
    case "top":
      return "translate3d(0, -100%, 0)";
    case "right":
      return "translate3d(100%, 0, 0)";
    case "left":
      return "translate3d(-100%, 0, 0)";
  }
}

interface SheetContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
}

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheetContext() {
  const context = React.useContext(SheetContext);
  if (!context) {
    throw new Error("Sheet components must be used within <Sheet>.");
  }
  return context;
}

export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const triggerRef = React.useRef<HTMLElement | null>(null);

  return (
    <SheetContext.Provider value={{ open, setOpen: onOpenChange, triggerRef }}>
      {children}
    </SheetContext.Provider>
  );
}

export function SheetTrigger({
  asChild = false,
  children,
}: {
  asChild?: boolean;
  children: React.ReactNode;
}) {
  const { setOpen, triggerRef } = useSheetContext();

  const handleOpen = (event?: React.MouseEvent<HTMLElement>) => {
    triggerRef.current = (event?.currentTarget as HTMLElement | null) ?? null;
    setOpen(true);
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) handleOpen(event);
      },
    });
  }

  return (
    <button type="button" onClick={handleOpen}>
      {children}
    </button>
  );
}

export function SheetClose({
  asChild = false,
  children,
}: {
  asChild?: boolean;
  children: React.ReactNode;
}) {
  const { setOpen } = useSheetContext();

  const handleClose = (event?: React.MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    setOpen(false);
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ onClick?: React.MouseEventHandler<HTMLElement> }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) handleClose(event);
      },
    });
  }

  return (
    <button type="button" onClick={handleClose}>
      {children}
    </button>
  );
}

export function SheetContent({
  className,
  children,
  side = "bottom",
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { side?: SheetSide }) {
  const { open, setOpen, triggerRef } = useSheetContext();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = React.useState(open);
  const [visualState, setVisualState] = React.useState<"open" | "closed">(open ? "open" : "closed");

  React.useEffect(() => {
    if (open) {
      setIsMounted(true);
      setVisualState("closed");
      let frameA = 0;
      let frameB = 0;
      frameA = window.requestAnimationFrame(() => {
        frameB = window.requestAnimationFrame(() => setVisualState("open"));
      });
      return () => {
        window.cancelAnimationFrame(frameA);
        window.cancelAnimationFrame(frameB);
      };
    }

    setVisualState("closed");
    if (!isMounted) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setIsMounted(false), SHEET_ANIMATION_MS + 20);
    return () => window.clearTimeout(timeout);
  }, [open, isMounted]);

  React.useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      const target =
        contentRef.current?.querySelector<HTMLElement>(
          "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ?? contentRef.current;
      target?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      (triggerRef.current ?? previousFocus)?.focus?.();
    };
  }, [open, setOpen, triggerRef]);

  if (!isMounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        aria-hidden="true"
        data-state={visualState}
        className={cn(
          "absolute inset-0 bg-black/45 backdrop-blur-[1px]",
          "transition-opacity ease-out",
          "data-[state=open]:opacity-100 data-[state=closed]:opacity-0",
        )}
        style={{ transitionDuration: `${SHEET_ANIMATION_MS}ms` }}
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
          "absolute flex flex-col bg-card text-foreground shadow-2xl outline-none transition-[transform,opacity] ease-out",
          "opacity-100",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[2rem] border-t border-border",
          side === "top" && "inset-x-0 top-0 rounded-b-[2rem] border-b border-border",
          side === "right" && "inset-y-0 right-0 h-full w-full max-w-md border-l border-border",
          side === "left" && "inset-y-0 left-0 h-full w-full max-w-md border-r border-border",
          className,
        )}
        style={{
          ...(style ?? {}),
          transform: getSheetTransform(side, visualState),
          transitionDuration: `${SHEET_ANIMATION_MS}ms`,
          willChange: "transform",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-4", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-foreground", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
