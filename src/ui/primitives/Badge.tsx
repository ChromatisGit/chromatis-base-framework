import type { HTMLAttributes } from "react";

import { cn } from "./cn.js";

type BadgeVariant = "secondary" | "outline" | "accent" | "success" | "destructive";

const variantClasses: Record<BadgeVariant, string> = {
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border border-border bg-card text-foreground",
  accent: "bg-accent text-accent-foreground",
  success: "bg-[var(--success-light)] text-[var(--success)]",
  destructive: "bg-destructive/10 text-destructive",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  className,
  variant = "secondary",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
