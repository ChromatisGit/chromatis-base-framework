import type { HTMLAttributes, ReactNode } from "react";

import { Card } from "./Card.js";
import { cn } from "./cn.js";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  className,
  icon,
  title,
  description,
  action,
  ...props
}: EmptyStateProps) {
  return (
    <Card
      className={cn("w-full px-6 py-10 text-center", className)}
      {...props}
    >
      <div className="space-y-4">
        {icon ? <div className="mx-auto flex justify-center">{icon}</div> : null}
        <div className="space-y-2">
          <h2 className="text-xl font-medium text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action ? <div>{action}</div> : null}
      </div>
    </Card>
  );
}
