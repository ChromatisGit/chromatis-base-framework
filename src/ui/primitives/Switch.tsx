import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "role"
> {
  label: ReactNode;
  /** Visually hide the label while keeping it for assistive technology. */
  hideLabel?: boolean;
}

/** An on/off control that takes effect immediately. */
export function Switch({
  label,
  hideLabel = false,
  className,
  ...props
}: SwitchProps) {
  return (
    <label className={cn("switch", className)}>
      <input
        className="switch__input"
        type="checkbox"
        role="switch"
        {...props}
      />
      <span className={cn("switch__label", hideLabel && "visually-hidden")}>
        {label}
      </span>
    </label>
  );
}
