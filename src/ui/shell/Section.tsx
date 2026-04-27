import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  variant?: "default" | "settings"
}

export function Section({ title, variant = "default", className, children, ...props }: SectionProps) {
  if (variant === "settings") {
    return (
      <div className={cn("mb-6", className)} {...props}>
        {title && (
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 px-1">
            {title}
          </h2>
        )}
        <div className="bg-card rounded-2xl border border-border divide-y divide-border overflow-hidden">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("mb-8", className)} {...props}>
      {title && (
        <h2 className="text-base font-semibold text-foreground mb-4">{title}</h2>
      )}
      {children}
    </div>
  )
}
