import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  role?: "default" | "outline" | "primary";
}

export function IconButton({
  label,
  role = "default",
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cn(
        "icon-btn",
        role !== "default" && `icon-btn--${role}`,
        className,
      )}
      {...props}
    />
  );
}
