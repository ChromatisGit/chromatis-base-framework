import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export type ButtonRole =
  | "primary"
  | "secondary"
  | "accent"
  | "ghost"
  | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  role?: ButtonRole;
  size?: ButtonSize;
  blockMobile?: boolean;
  busy?: boolean;
}

export function buttonClassName({
  role = "primary",
  size = "md",
  blockMobile = false,
  className,
}: Pick<ButtonProps, "role" | "size" | "blockMobile" | "className">) {
  return cn(
    "btn",
    `btn--${role}`,
    size !== "md" && `btn--${size}`,
    blockMobile && "btn--block-mobile",
    className,
  );
}

export function Button({
  role = "primary",
  size = "md",
  blockMobile = false,
  busy = false,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ role, size, blockMobile, className })}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
