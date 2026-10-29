import { createContext } from 'react';
import type { User } from '@/api/auth';
import type { Role } from '@/api/types';

export type AuthState =
  { status: 'checking' } | { status: 'anonymous' } | { status: 'authenticated'; user: User };

export interface AuthContextValue {
  state: AuthState;
  /** `allowedRoles` keeps a portal to its own people: other roles are refused before a session is kept. */
  signIn: (email: string, password: string, allowedRoles?: Role[]) => Promise<void>;
  signOut: () => Promise<void>;
}

/** The credentials were right, but this portal is not for that kind of account. */
export class WrongPortalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongPortalError';
  }
}

export const AuthContext = createContext<AuthContextValue | null>(null);
