import type { ReactNode } from 'react';
import { ApiError } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="grid gap-3" data-testid="loading">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-dashed border-line bg-white px-6 py-10 text-center"
      data-testid="empty"
    >
      <p className="font-display text-lg tracking-tight">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function describeError(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError) {
    if (error.status === 403)
      return {
        title: 'You do not have access to this',
        detail: 'Your role is not allowed to do this. Nothing was changed.',
      };
    if (error.status === 404)
      return { title: 'Not found', detail: 'This item does not exist, or you cannot see it.' };
    if (error.status === 409) return { title: 'This item has changed', detail: error.message };
    return { title: 'Something went wrong', detail: error.message };
  }
  return { title: 'Cannot reach the server', detail: 'Check your connection and try again.' };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, detail } = describeError(error);
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger/30 bg-danger-soft px-5 py-6"
      data-testid="error"
    >
      <p className="font-semibold text-danger">{title}</p>
      <p className="mt-1 text-sm text-danger">{detail}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
