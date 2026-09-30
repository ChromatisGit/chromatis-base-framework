import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: "neutral" | "info" | "success" | "warning" | "error";
}

export function Badge({ status = "neutral", className, ...props }: BadgeProps) {
  return (
    <span className={cn("badge", `badge--${status}`, className)} {...props} />
  );
}
