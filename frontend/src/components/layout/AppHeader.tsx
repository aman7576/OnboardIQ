import type { ReactNode } from 'react';

/** Wordmark + optional right-hand content (user menu). Same header as the RetailPulse storefront. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-6">
        <span className="font-display text-2xl tracking-tight">
          OnboardIQ
          <span className="ml-1 align-super font-sans text-[0.6rem] font-semibold tracking-widest text-forest">
            KYC
          </span>
        </span>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="hidden text-ink-soft sm:inline">Deccan Digital Bank</span>
          {children}
        </div>
      </div>
    </header>
  );
}
