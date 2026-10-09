import { type SelectHTMLAttributes, useId } from "react";
import { ChevronDown } from "lucide-react";
import { FieldFrame, fieldDescription } from "../forms/FieldFrame.js";
import { cn } from "./cn.js";

export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children"
> {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: string;
  error?: string;
  optional?: string;
  visuallyHiddenLabel?: boolean;
}

export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  optional,
  visuallyHiddenLabel,
  id,
  className,
  "aria-describedby": describedBy,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <FieldFrame
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      visuallyHiddenLabel={visuallyHiddenLabel}
    >
      <span className="select">
        <select
          id={selectId}
          className={cn("select__control", className)}
          {...props}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={fieldDescription(
            selectId,
            hint,
            error,
            describedBy,
          )}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map(({ value, label: optionLabel }) => (
            <option key={value} value={value}>
              {optionLabel}
            </option>
          ))}
        </select>
        <ChevronDown className="icon" aria-hidden="true" />
      </span>
    </FieldFrame>
  );
}
