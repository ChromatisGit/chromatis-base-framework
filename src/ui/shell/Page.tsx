import { type HTMLAttributes, useEffect } from "react";
import { cn } from "../primitives/cn.js";

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  width?: "reading" | "content" | "wide";
}

export function Page({
  title,
  width = "reading",
  className,
  children,
  ...props
}: PageProps) {
  useEffect(() => {
    if (title) {
      document.title = title;
    }
  }, [title]);

  return (
    <div
      className={cn(
        "container",
        "page",
        width !== "content" && `container--${width}`,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
