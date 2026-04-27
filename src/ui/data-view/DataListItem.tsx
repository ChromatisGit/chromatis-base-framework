import { type ReactNode } from "react"
import { Link } from "react-router"
import { ChevronRight } from "lucide-react"
import { cn } from "../primitives/cn"

interface DataListItemProps {
  label: string
  description?: string
  icon?: ReactNode
  meta?: ReactNode
  action?: ReactNode
  href?: string
  onClick?: () => void
  chevron?: boolean
  className?: string
}

export function DataListItem({
  label,
  description,
  icon,
  meta,
  action,
  href,
  onClick,
  chevron,
  className,
}: DataListItemProps) {
  const isInteractive = Boolean(href ?? onClick)

  const content = (
    <>
      {icon && (
        <span className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{description}</p>
        )}
      </div>
      {meta && <div className="flex-shrink-0 flex items-center">{meta}</div>}
      {action && <div className="flex-shrink-0 flex items-center gap-1">{action}</div>}
      {chevron && <ChevronRight className="flex-shrink-0 w-4 h-4 text-muted-foreground" />}
    </>
  )

  const baseClass = cn(
    "flex items-center gap-3 px-4 py-3 w-full text-left",
    isInteractive && "transition-colors hover:bg-muted/50 cursor-pointer",
    className,
  )

  if (href) {
    return (
      <Link to={href} className={cn(baseClass, "no-underline")}>
        {content}
      </Link>
    )
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={baseClass}>
        {content}
      </button>
    )
  }

  return <div className={baseClass}>{content}</div>
}
