import type { ReactNode } from "react"
import { Switch } from "../primitives/Switch"
import { useFormContext } from "./formContext"
import { cn } from "../primitives/cn"

interface SwitchFieldProps {
  label: string
  description?: string
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  action?: ReactNode
  className?: string
}

export function SwitchField({
  label,
  description,
  name,
  checked,
  onChange,
  disabled,
  action,
  className,
}: SwitchFieldProps) {
  const { isPending } = useFormContext()
  const isDisabled = isPending || disabled

  return (
    <div className={cn("flex items-center justify-between gap-4 py-3 px-1", className)}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium text-foreground leading-snug">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {action}
        <Switch
          {...(name !== undefined ? { name } : {})}
          checked={checked}
          onChange={onChange}
          disabled={!!isDisabled}
        />
      </div>
    </div>
  )
}
