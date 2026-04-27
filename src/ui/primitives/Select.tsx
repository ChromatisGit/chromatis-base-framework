import { type SelectHTMLAttributes, useId } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "./cn"

interface SelectOption {
  value: string
  label: string
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string
  options: SelectOption[]
  placeholder?: string
  hint?: string
  error?: string
}

export function Select({ label, options, placeholder, hint, error, id, className, ...props }: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={cn(
            "w-full appearance-none rounded-xl border bg-input-background px-3 py-2.5 pr-9",
            "text-sm text-foreground outline-none transition-colors",
            "focus:ring-2 focus:ring-ring/50 focus:border-ring",
            error
              ? "border-destructive focus:ring-destructive/30"
              : "border-border",
            props.disabled && "opacity-50 cursor-not-allowed",
            className
          )}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          strokeWidth={2}
        />
      </div>
      {hint && !error && (
        <p id={`${selectId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${selectId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
