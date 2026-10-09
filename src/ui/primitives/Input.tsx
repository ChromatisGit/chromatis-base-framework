import { type InputHTMLAttributes, useId } from "react";
import { FieldFrame, fieldDescription } from "../forms/FieldFrame.js";
import { cn } from "./cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  optional?: string;
}

export function Input({
  label,
  hint,
  error,
  optional,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <FieldFrame
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
    >
      <input
        id={inputId}
        className={cn("input", className)}
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={fieldDescription(inputId, hint, error, describedBy)}
      />
    </FieldFrame>
  );
}
