import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-line bg-white px-3 text-sm placeholder:text-ink-soft/60 transition focus-visible:border-forest focus-visible:shadow-[0_0_0_4px_rgba(31,77,58,0.12)] disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
