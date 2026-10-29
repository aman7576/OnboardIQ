import { cn } from '@/lib/utils';

/**
 * Confidence of an extracted value. `limit` comes from the backend (the configured minimum); a value below it is
 * marked with text and a symbol as well as colour.
 */
export function ConfidenceMeter({ value, limit }: { value: number; limit: number }) {
  const low = value < limit;
  return (
    <div className="flex items-center gap-2" data-testid="confidence">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ivory-deep" aria-hidden>
        <div
          className={cn('h-full rounded-full', low ? 'bg-danger' : 'bg-forest')}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="tabular text-xs font-medium">{value.toFixed(2)}</span>
      {low && <span className="text-xs font-semibold text-danger">▲ below {limit.toFixed(2)}</span>}
    </div>
  );
}
