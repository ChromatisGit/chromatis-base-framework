import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "./cn.js";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
  mandatory?: boolean;
  className?: string;
}

function outside(
  event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>,
) {
  if (event.target !== event.currentTarget) {
    return false;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  actions,
  closeLabel,
  mandatory = false,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const backdropPress = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (mandatory) {
      dialog.setAttribute("closedby", "none");
    } else {
      dialog.removeAttribute("closedby");
    }
    if (open && !dialog.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
      (
        dialog.querySelector<HTMLElement>("[autofocus]") ??
        dialog.querySelector<HTMLElement>(".dialog__title")
      )?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, mandatory]);

  function onClose() {
    onOpenChange(false);
    if (returnFocus.current?.isConnected) {
      returnFocus.current.focus();
    }
  }

  return (
    <dialog
      ref={ref}
      className={cn("dialog", className)}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        if (mandatory) {
          event.preventDefault();
        } else {
          onOpenChange(false);
        }
      }}
      onPointerDown={(event) => {
        backdropPress.current = outside(event);
      }}
      onClick={(event) => {
        if (!mandatory && backdropPress.current && outside(event)) {
          backdropPress.current = false;
          onOpenChange(false);
        }
      }}
    >
      <div className="dialog__inner">
        <div className="dialog__header">
          <h2 className="dialog__title" id={titleId} tabIndex={-1}>
            {title}
          </h2>
          {!mandatory && (
            <button
              type="button"
              className="icon-btn dialog__close"
              aria-label={closeLabel}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="dialog__body">{children}</div>
        {actions && <div className="dialog__actions btn-group">{actions}</div>}
      </div>
    </dialog>
  );
}
