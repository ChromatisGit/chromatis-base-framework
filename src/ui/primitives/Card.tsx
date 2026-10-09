import type { HTMLAttributes, ReactNode } from "react";
import { Link as RouterLink, type LinkProps } from "react-router";
import { cn } from "./cn.js";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  kind?: "content" | "media" | "stat";
  surface?: "default" | "subtle" | "accent";
  border?: "none" | "default" | "strong";
  orientation?: "vertical" | "horizontal";
  media?: "none" | "top" | "side";
  emphasis?: "default" | "strong";
}

export function Card({
  kind = "content",
  surface,
  border,
  orientation,
  media,
  emphasis,
  className,
  ...props
}: CardProps) {
  return (
    <article
      className={cn("card", `card--${kind}`, className)}
      data-surface={surface}
      data-border={border}
      data-orientation={orientation}
      data-media={media}
      data-emphasis={emphasis}
      {...props}
    />
  );
}

/** The whole card is one navigation link. Do not nest interactive controls. */
export interface ActionCardProps extends LinkProps {
  surface?: CardProps["surface"];
  border?: CardProps["border"];
  orientation?: CardProps["orientation"];
  media?: CardProps["media"];
  emphasis?: CardProps["emphasis"];
}

export function ActionCard({
  surface,
  border,
  orientation,
  media,
  emphasis,
  className,
  ...props
}: ActionCardProps) {
  return (
    <RouterLink
      className={cn("card", "card--action", className)}
      data-surface={surface}
      data-border={border}
      data-orientation={orientation}
      data-media={media}
      data-emphasis={emphasis}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card__body", className)} {...props} />;
}

export function CardMedia({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("card__media", className)} {...props}>
      {children}
    </div>
  );
}

export function CardValue({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("card__value", className)} {...props} />;
}

export function CardLabel({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("card__label", className)} {...props} />;
}
