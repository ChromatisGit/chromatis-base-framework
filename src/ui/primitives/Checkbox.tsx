import { type InputHTMLAttributes, useId } from "react"
import { Check } from "lucide-react"
import { cn } from "./cn"

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string
  description?: string
  error?: string
}

export function Checkbox({ label, description, error, id, className, ...props }: CheckboxProps) {
  const generatedId = useId()
  const checkboxId = id ?? generatedId

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <div className="relative flex-shrink-0 mt-0.5">
        <input
          id={checkboxId}
          type="checkbox"
          className="peer sr-only"
          aria-invalid={error ? "true" : undefined}
          {...props}
        />
        <label
          htmlFor={checkboxId}
          className={cn(
            "flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border-2 transition-colors",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
            "peer-checked:bg-primary peer-checked:border-primary",
            "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
            error ? "border-destructive" : "border-border bg-input-background"
          )}
        >
          <Check className="hidden h-3 w-3 text-primary-foreground peer-checked:block [.peer:checked~&]:block" strokeWidth={3} />
        </label>
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <label
          htmlFor={checkboxId}
          className="text-sm font-medium text-foreground cursor-pointer leading-snug"
        >
          {label}
        </label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  )
}
