import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({
  title,
  description,
  icon,
  actions,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn("empty-state", className)} {...props}>
      {icon && (
        <span className="empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <h2 className="empty-state__title">{title}</h2>
      {description && <p className="empty-state__text">{description}</p>}
      {actions && <div className="btn-group">{actions}</div>}
    </div>
  );
}
