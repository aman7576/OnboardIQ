import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  info: 'border-[#b9cfe2] bg-[#eef4f9] text-[#1f4c73]',
  warning: 'border-amber/40 bg-amber-soft text-amber',
  danger: 'border-danger/30 bg-danger-soft text-danger',
  success: 'border-forest/30 bg-forest-soft text-forest',
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}
