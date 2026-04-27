import { type HTMLAttributes, useEffect } from "react"
import { cn } from "../primitives/cn"

interface PageProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
}

export function Page({ title, className, children, ...props }: PageProps) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])

  return (
    <div
      className={cn("flex flex-col min-h-full w-full overflow-y-auto", className)}
      {...props}
    >
      <div className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </div>
    </div>
  )
}
