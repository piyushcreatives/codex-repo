import { AlertCircle } from "lucide-react";
import { isUnauthorizedError, isFeatureUnavailableError } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingList } from "@/components/ui/loading-list";

/**
 * Turn a query error into a friendly, user-facing message.
 * Mirrors the gold-standard handling in Files.tsx so every page treats 401 /
 * feature-unavailable / generic failures consistently.
 */
export function getQueryErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string | null {
  if (!error) return null;
  if (isUnauthorizedError(error)) return "Your session expired. Please sign in again.";
  if (isFeatureUnavailableError(error)) return "This feature is unavailable for your Nextcloud connection.";
  return error instanceof Error ? error.message : fallback;
}

/** Inline error block, styled to match EmptyState. */
export function ErrorState({ message, className }: { message: string; className?: string }) {
  return <EmptyState icon={AlertCircle} title="Couldn’t load this" description={message} className={className} />;
}

type QueryLike<T> = {
  isLoading: boolean;
  error: unknown;
  data: T | undefined;
};

/**
 * Standardizes the loading → error → empty → data render flow for a React Query result.
 *
 *   <QueryState query={q} isEmpty={(d) => d.length === 0} empty={<EmptyState .../>}>
 *     {(data) => <List items={data} />}
 *   </QueryState>
 */
export function QueryState<T>({
  query,
  loading,
  isEmpty,
  empty,
  children,
}: {
  query: QueryLike<T>;
  loading?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}) {
  if (query.isLoading) return <>{loading ?? <LoadingList />}</>;

  const message = getQueryErrorMessage(query.error);
  if (message) return <ErrorState message={message} />;

  if (query.data === undefined) return <ErrorState message="No data available." />;

  if (isEmpty && isEmpty(query.data)) return <>{empty ?? null}</>;

  return <>{children(query.data)}</>;
}
