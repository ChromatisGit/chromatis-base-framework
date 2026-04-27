import { type HTMLAttributes } from "react"
import { cn } from "../primitives/cn"

interface ContentLayoutProps extends HTMLAttributes<HTMLDivElement> {
  narrow?: boolean
}

export function ContentLayout({ narrow = false, className, children, ...props }: ContentLayoutProps) {
  return (
    <div
      className={cn(
        "w-full mx-auto px-4 sm:px-6",
        narrow ? "max-w-[560px]" : "max-w-[720px]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
