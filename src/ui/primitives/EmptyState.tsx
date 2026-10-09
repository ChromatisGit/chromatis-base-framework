import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  nextStep: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({
  title,
  description,
  nextStep,
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
      <p className="empty-state__text">{description}</p>
      <p className="empty-state__text">{nextStep}</p>
      {actions && <div className="btn-group">{actions}</div>}
    </div>
  );
}
