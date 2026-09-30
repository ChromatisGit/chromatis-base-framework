import type { HTMLAttributes, ReactNode, TableHTMLAttributes } from "react";
import { cn } from "./cn.js";

export interface DataTableProps extends TableHTMLAttributes<HTMLTableElement> {
  caption: string;
  children: ReactNode;
  wrapperClassName?: string;
}

export function DataTable({
  caption,
  children,
  className,
  wrapperClassName,
  ...props
}: DataTableProps) {
  return (
    <div
      className={cn("table-wrap", wrapperClassName)}
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className={cn("table", className)} {...props}>
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function RecordList({
  className,
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("record-list", className)} {...props} />;
}

export function RecordListItem({
  className,
  ...props
}: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn("record-list__item", className)} {...props} />;
}

export function RecordTitle({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("record-list__title", className)} {...props} />;
}

export function RecordMeta({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("record-list__meta", className)} {...props} />;
}

export function RecordStatus({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("record-list__status", className)} {...props} />;
}
