import {
  useId,
  type HTMLAttributes,
  type ProgressHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn.js";

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "md" | "lg";
  label?: string;
}
export function Spinner({
  size = "md",
  label,
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      className={cn("spinner", size === "lg" && "spinner--lg", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    />
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  shape?: "text" | "title";
}
export function Skeleton({
  shape = "text",
  className,
  ...props
}: SkeletonProps) {
  return (
    <span
      className={cn("skeleton", `skeleton--${shape}`, className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export interface ProgressProps extends ProgressHTMLAttributes<HTMLProgressElement> {
  label: ReactNode;
  value: number;
  max?: number;
  displayValue?: ReactNode;
}
export function Progress({
  label,
  value,
  max = 100,
  displayValue,
  ...props
}: ProgressProps) {
  const labelId = useId();
  return (
    <div className="progress">
      <div className="progress__meta">
        <span id={labelId}>{label}</span>
        <span className="num">
          {displayValue ?? `${Math.round((value / max) * 100)}%`}
        </span>
      </div>
      <progress
        className="progress__bar"
        value={value}
        max={max}
        aria-labelledby={labelId}
        {...props}
      />
    </div>
  );
}
