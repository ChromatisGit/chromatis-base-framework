import { type TextareaHTMLAttributes, useId } from "react";
import { cn } from "../primitives/cn.js";
import { FieldFrame, fieldDescription } from "./FieldFrame.js";
import { useFormContext } from "./formContext.js";

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  optional?: string;
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  id,
  disabled,
  className,
  "aria-describedby": describedBy,
  ...props
}: TextAreaFieldProps) {
  const { isPending } = useFormContext();
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
    >
      <textarea
        id={fieldId}
        rows={4}
        disabled={isPending || disabled}
        className={cn("textarea", className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={fieldDescription(fieldId, hint, error, describedBy)}
        {...props}
      />
    </FieldFrame>
  );
}
