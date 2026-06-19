import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Standard loading placeholder: N skeleton rows.
 * Replaces the repeated `Array.from({ length: N }).map(() => <Skeleton/>)` across pages.
 */
export function LoadingList({
  count = 5,
  rowClassName = "h-10 w-full",
  className,
}: {
  count?: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={rowClassName} />
      ))}
    </div>
  );
}
