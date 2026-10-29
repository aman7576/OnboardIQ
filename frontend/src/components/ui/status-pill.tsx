import { cn } from '@/lib/utils';

export type Tone = 'good' | 'bad' | 'wait';

const TONE: Record<Tone, string> = {
  good: 'bg-forest-soft text-forest',
  bad: 'bg-danger-soft text-danger',
  wait: 'bg-ivory-deep text-ink-soft',
};

export function StatusPill({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONE[tone],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
