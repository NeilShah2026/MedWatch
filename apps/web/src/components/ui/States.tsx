import type { ReactNode } from 'react';
import { common } from '@/copy/common';
import { Button } from './Button';
import { IconAlert, IconInfo } from './icons';

export function Loading({ label = common.loading }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 p-6 text-ink-muted">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="card flex flex-col items-center gap-2 py-10 text-center"
      data-testid="empty-state"
    >
      <IconInfo className="text-primary" />
      <p className="text-lg font-semibold">{title}</p>
      {body ? <p className="max-w-prose text-ink-muted">{body}</p> : null}
      {action}
    </div>
  );
}

/** Never shows raw error text: messages can contain PHI or internals (spec §9). */
export function ErrorState({
  onRetry,
  message = common.genericError,
}: {
  onRetry?: () => void;
  message?: string;
}) {
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 py-8 text-center">
      <IconAlert className="text-severity-high" />
      <p className="font-semibold">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {common.retry}
        </Button>
      ) : null}
    </div>
  );
}

/** Render loading / error / empty / content for a TanStack Query result. */
export function QueryState<T>({
  query,
  empty,
  children,
  isEmpty,
}: {
  query: { isLoading: boolean; isError: boolean; data: T | undefined; refetch: () => unknown };
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <Loading />;
  if (query.isError || query.data === undefined)
    return <ErrorState onRetry={() => void query.refetch()} />;
  if (empty && isEmpty?.(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
