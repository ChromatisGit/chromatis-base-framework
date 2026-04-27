import type { ReactNode } from "react"
import { cn } from "../primitives/cn"

interface StateViewProps {
  state: "loading" | "empty" | "error"
  title?: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

function Spinner() {
  return (
    <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" />
  )
}

const defaults: Record<StateViewProps["state"], { title: string; description: string }> = {
  loading: { title: "Loading…", description: "" },
  empty: { title: "Nothing here yet", description: "Add something to get started." },
  error: { title: "Something went wrong", description: "Try refreshing the page." },
}

export function StateView({ state, title, description, action, icon, className }: StateViewProps) {
  const d = defaults[state]

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 w-full px-6 py-16 text-center",
        className
      )}
    >
      <div className="text-muted-foreground">
        {state === "loading" ? <Spinner /> : (icon ?? null)}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-medium text-foreground">{title ?? d.title}</p>
        {(description ?? d.description) && (
          <p className="text-sm text-muted-foreground max-w-xs">{description ?? d.description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
