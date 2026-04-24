import type { HTMLAttributes } from "react";

import { cn } from "./cn.js";

type CardTone = "default" | "muted" | "accent";

const toneClasses: Record<CardTone, string> = {
  default: "bg-card",
  muted: "bg-muted/50",
  accent: "bg-accent/50",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone;
  interactive?: boolean;
}

export function Card({
  className,
  tone = "default",
  interactive = false,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-border",
        toneClasses[tone],
        interactive && "transition-all hover:border-primary hover:bg-accent/50",
        className,
      )}
      {...props}
    />
  );
}
