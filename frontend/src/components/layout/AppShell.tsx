import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { ChatBot } from '@/features/applicant/ChatBot';
import { useAuth } from '@/features/auth/useAuth';
import { NAV_BY_ROLE } from '@/lib/navigation';
import { ROLE_LABEL } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { AppFooter } from './AppFooter';

/**
 * Header, role-specific navigation and the page outlet. The links shown depend on the role purely for convenience:
 * every action behind them is authorised again by the backend.
 */
export function AppShell() {
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  if (state.status === 'checking')
    return (
      <p role="status" className="p-8 text-ink-soft">
        Checking your session…
      </p>
    );
  if (state.status !== 'authenticated') return <Navigate to="/login" replace />;
  const user = state.user;
  const links = NAV_BY_ROLE[user.role];
  const staff = user.role !== 'APPLICANT';
  const initials = user.display_name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen flex-col bg-ivory">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header
        className={cn(
          'sticky top-0 z-30 border-b backdrop-blur-md',
          staff
            ? 'relative overflow-hidden border-forest bg-forest-deep text-white'
            : 'border-line bg-white/75',
        )}
      >
        {staff && (
          <span
            aria-hidden="true"
            className="fx-sweep pointer-events-none absolute right-0 bottom-0 left-0 h-0.5 overflow-hidden bg-emerald-300/30"
          />
        )}
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2 font-display text-2xl tracking-tight">
            <span
              className={cn(
                'grid h-8 w-8 place-items-center rounded-lg text-white',
                staff ? 'bg-white/15 ring-1 ring-white/25' : 'bg-forest',
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6L12 2Z"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="m8.5 12 2.4 2.4L15.7 9.6"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>
              OnboardIQ
              <span
                className={cn(
                  'ml-1 align-super font-sans text-[0.6rem] font-semibold tracking-widest',
                  staff ? 'text-emerald-300' : 'text-forest',
                )}
              >
                {staff ? 'OFFICER' : 'KYC'}
              </span>
            </span>
          </span>
          <button
            type="button"
            className={cn(
              'ml-auto rounded-md border px-3 py-1.5 text-sm md:hidden',
              staff ? 'border-white/30' : 'border-line',
            )}
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((v) => !v)}
          >
            Menu
          </button>
          <nav
            id="main-nav"
            aria-label="Main"
            className={cn(
              'order-3 w-full flex-wrap gap-x-5 gap-y-1 text-sm md:order-none md:flex md:w-auto',
              open ? 'flex' : 'hidden',
            )}
          >
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end ?? false}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'py-1 transition-colors',
                    staff
                      ? cn(
                          'rounded-full px-3',
                          isActive
                            ? 'bg-white/15 text-white'
                            : 'text-forest-soft hover:bg-white/10 hover:text-white',
                        )
                      : cn(
                          'border-b-2',
                          isActive
                            ? 'border-forest text-ink'
                            : 'border-transparent text-ink-soft hover:text-ink',
                        ),
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 text-sm md:flex">
            {staff && (
              <span className="relative grid h-9 w-9 place-items-center rounded-full bg-emerald-300 text-xs font-bold text-ink">
                {initials}
                <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-forest-deep bg-emerald-500" />
              </span>
            )}
            <span className="text-right leading-tight">
              <span className="block font-medium">{user.display_name}</span>
              <span className={cn('block text-xs', staff ? 'text-forest-soft' : 'text-ink-soft')}>
                {ROLE_LABEL[user.role]}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className={
                staff ? 'border-white/30 text-white hover:bg-white/10 hover:text-white' : ''
              }
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </div>
        <div
          className={cn(
            'border-t px-4 py-2 text-sm md:hidden',
            staff ? 'border-white/15' : 'border-line',
            open ? 'flex items-center justify-between' : 'hidden',
          )}
        >
          <span>
            {user.display_name} · {ROLE_LABEL[user.role]}
          </span>
          <Button variant="outline" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <div key={location.pathname} className="fx-up">
          <Outlet />
        </div>
      </main>
      {user.role === 'APPLICANT' && <ChatBot />}
      <AppFooter />
    </div>
  );
}
