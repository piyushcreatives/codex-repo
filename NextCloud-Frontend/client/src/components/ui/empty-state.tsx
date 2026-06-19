import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Standard empty-state block: centered icon + title + optional description + optional action.
 * Replaces the hand-rolled "centered icon + muted text" markup duplicated across pages.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      {Icon && <Icon className="mb-2 h-10 w-10 text-muted-foreground/40" aria-hidden="true" />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
