import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  status?: "info" | "success" | "warning" | "error";
  /** Announce newly displayed messages; static notices stay out of live regions. */
  live?: boolean;
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function Alert({
  status = "info",
  live = false,
  title,
  icon,
  actions,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      className={cn("alert", `alert--${status}`, className)}
      {...props}
      role={live ? (status === "error" ? "alert" : "status") : undefined}
    >
      {icon && (
        <span className="alert__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="alert__content">
        {title && <strong className="alert__title">{title}</strong>}
        {children}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
    </div>
  );
}
