import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";
import { buttonClassName, type ButtonRole, type ButtonSize } from "./Button.js";
import { cn } from "./cn.js";

type RouterLinkProps = ComponentProps<typeof RouterLink>;

export interface ActionLinkProps extends RouterLinkProps {
  role?: ButtonRole;
  size?: ButtonSize;
  blockMobile?: boolean;
}

export function ActionLink({
  role = "primary",
  size = "md",
  blockMobile = false,
  className,
  ...props
}: ActionLinkProps) {
  return (
    <RouterLink
      className={buttonClassName({ role, size, blockMobile, className })}
      {...props}
    />
  );
}

export interface TextLinkProps extends RouterLinkProps {
  standalone?: boolean;
}

export function TextLink({
  standalone = false,
  className,
  ...props
}: TextLinkProps) {
  return (
    <RouterLink
      className={cn("link", standalone && "link--standalone", className)}
      {...props}
    />
  );
}
