import { type InputHTMLAttributes, useId } from "react"
import { cn } from "./cn"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={inputId}
        className={cn(
          "w-full rounded-xl border bg-input-background px-3 py-2.5 text-sm text-foreground",
          "placeholder:text-muted-foreground/60 outline-none transition-colors",
          "focus:ring-2 focus:ring-ring/50 focus:border-ring",
          error
            ? "border-destructive focus:ring-destructive/30"
            : "border-border",
          props.disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        {...props}
      />
      {hint && !error && (
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
