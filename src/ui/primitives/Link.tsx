import type { ComponentProps } from "react";
import { Link as RouterLink } from "react-router";
import { cn } from "./cn.js";

type RouterLinkProps = ComponentProps<typeof RouterLink>;

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
