import type { Role } from '@/api/types';

export interface NavLinkDef {
  to: string;
  label: string;
  end?: boolean;
}

export const NAV_BY_ROLE: Record<Role, NavLinkDef[]> = {
  APPLICANT: [
    { to: '/applications', label: 'My applications', end: true },
    { to: '/applications/new', label: 'New application' },
  ],
  KYC_OFFICER: [{ to: '/review', label: 'Review queue' }],
  COMPLIANCE_OFFICER: [
    { to: '/checker', label: 'Checker queue' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/audit', label: 'Audit' },
    { to: '/maintenance', label: 'Maintenance' },
    { to: '/ai-evaluation', label: 'AI evaluation' },
  ],
};

/** Where each role lands after signing in. */
export const HOME_BY_ROLE: Record<Role, string> = {
  APPLICANT: '/applications',
  KYC_OFFICER: '/review',
  COMPLIANCE_OFFICER: '/dashboard',
};
