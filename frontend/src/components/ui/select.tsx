import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-line bg-white px-3 text-sm focus-visible:border-forest disabled:opacity-60 aria-[invalid=true]:border-danger',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
