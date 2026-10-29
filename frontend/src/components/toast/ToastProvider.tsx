import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ToastContext, type ToastApi } from './toast-context';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}
const STYLE: Record<Kind, string> = {
  success: 'border-forest/40 bg-white text-forest',
  error: 'border-danger/40 bg-white text-danger',
  info: 'border-line bg-white text-ink',
};

export function ToastProvider({
  children,
  duration = 6000,
}: {
  children: ReactNode;
  duration?: number;
}) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (kind: Kind, message: string) => {
      const id = next.current++;
      setItems((all) => [...all.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? duration * 1.5 : duration);
    },
    [dismiss, duration],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 grid w-[min(24rem,calc(100vw-2rem))] gap-2"
        aria-label="Notifications"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg',
              STYLE[t.kind],
            )}
          >
            <span aria-hidden className="font-bold">
              {t.kind === 'success' ? '✓' : t.kind === 'error' ? '✕' : 'i'}
            </span>
            <p className="flex-1 text-ink">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-ink-soft hover:text-ink"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
