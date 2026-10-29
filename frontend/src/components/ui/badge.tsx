import type { ReactNode } from 'react';
import { TONE_CLASS, type Tone } from '@/lib/status';
import { cn } from '@/lib/utils';

const ICON: Record<Tone, string> = {
  success: '✓',
  danger: '✕',
  warning: '!',
  info: 'i',
  neutral: '·',
};

/** A pill with a symbol as well as a colour, so meaning never depends on colour alone. */
export function Badge({
  tone = 'neutral',
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden className="text-[0.7rem] leading-none">
        {ICON[tone]}
      </span>
      {children}
    </span>
  );
}
