import type { User } from '@/api/auth';

// The session lives in sessionStorage: it is gone when the tab closes and is never shared between
// tabs. (It is readable by scripts on this page, so the app must never render untrusted HTML.)
const KEY = 'onboardiq.session';

export interface StoredSession {
  token: string;
  expires_at: string;
  user: User;
}

export const tokenStore = {
  read(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as StoredSession;
      if (Date.parse(session.expires_at) <= Date.now()) {
        sessionStorage.removeItem(KEY);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  },
  write(session: StoredSession): void {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable (private mode): the user simply signs in again after a reload */
    }
  },
  clear(): void {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  },
};
