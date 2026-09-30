import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  status?: "info" | "success" | "warning" | "error";
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function Alert({
  status = "info",
  title,
  icon,
  actions,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role={status === "error" ? "alert" : "status"}
      className={cn("alert", `alert--${status}`, className)}
      {...props}
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
