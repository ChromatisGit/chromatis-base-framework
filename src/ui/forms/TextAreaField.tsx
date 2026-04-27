import { type TextareaHTMLAttributes, useId } from "react"
import { cn } from "../primitives/cn"
import { useFormContext } from "./formContext"

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
  error?: string
}

export function TextAreaField({ label, hint, error, id, disabled, className, ...props }: TextAreaFieldProps) {
  const { isPending } = useFormContext()
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const isDisabled = isPending || disabled

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={4}
        disabled={isDisabled}
        className={cn(
          "w-full rounded-xl border bg-input-background px-3 py-2.5 text-sm text-foreground",
          "placeholder:text-muted-foreground/60 outline-none transition-colors resize-none",
          "focus:ring-2 focus:ring-ring/50 focus:border-ring",
          error
            ? "border-destructive focus:ring-destructive/30"
            : "border-border",
          isDisabled && "opacity-50 cursor-not-allowed",
          className
        )}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        {...props}
      />
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
