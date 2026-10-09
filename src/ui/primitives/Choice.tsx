import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface ChoiceProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  type: "checkbox" | "radio";
  label: ReactNode;
  hint?: ReactNode;
}

/** A checkbox or radio with its label as one target. */
export function Choice({
  type,
  label,
  hint,
  className,
  ...props
}: ChoiceProps) {
  return (
    <label className={cn("choice", className)}>
      <input className="choice__input" type={type} {...props} />
      <span className="choice__text">
        {label}
        {hint && <span className="choice__hint">{hint}</span>}
      </span>
    </label>
  );
}

export interface ChoiceGroupProps {
  legend: ReactNode;
  /** Visually hide the legend while keeping it for assistive technology. */
  hideLegend?: boolean;
  inline?: boolean;
  className?: string;
  children: ReactNode;
}

/** A fieldset for related checkboxes or radios. */
export function ChoiceGroup({
  legend,
  hideLegend = false,
  inline = false,
  className,
  children,
}: ChoiceGroupProps) {
  return (
    <fieldset className={cn("fieldset", className)}>
      <legend
        className={cn("fieldset__legend", hideLegend && "visually-hidden")}
      >
        {legend}
      </legend>
      <div className={cn("choice-list", inline && "choice-list--inline")}>
        {children}
      </div>
    </fieldset>
  );
}
