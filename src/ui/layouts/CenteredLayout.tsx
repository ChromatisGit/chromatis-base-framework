import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface CenteredLayoutProps extends HTMLAttributes<HTMLDivElement> {
  maxWidth?: number
}

export function CenteredLayout({ maxWidth = 400, className, children, ...props }: CenteredLayoutProps) {
  return (
    <div
      className={cn("flex min-h-full flex-col items-center justify-center py-8 px-4", className)}
      {...props}
    >
      <div className="w-full" style={{ maxWidth }}>
        {children}
      </div>
    </div>
  )
}
