import { timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { conflict, HttpError, tooManyRequests, unauthorized } from '../../http/errors.js';
import { ANONYMOUS, actorOf, recordAudit } from '../audit/audit.js';
import type { LoginThrottle } from './login-throttle.js';
import {
  burnPasswordCheck,
  DEFAULT_SCRYPT,
  hashPassword,
  verifyPassword,
  type ScryptParams,
} from './password.js';
import type { LoginBody, RegisterBody, StaffRegisterBody } from './schemas.js';
import { hashSessionToken, newSessionToken } from './session-token.js';

export interface AuthDeps {
  prisma: PrismaClient;
  sessionSecret: string;
  sessionTtlMinutes: number;
  throttle: LoginThrottle;
  now: () => Date;
  /** Code the bank hands to new officers; without it officer registration is switched off. */
  staffEnrollmentCode?: string;
  hashParams?: ScryptParams; // tests use cheap parameters; production uses DEFAULT_SCRYPT
}

export interface PublicUser {
  id: string;
  email: string;
  display_name: string;
  role: Role;
}

export interface LoginResult {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
  user: PublicUser;
}

const INVALID_CREDENTIALS = () =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid e-mail or password');

export function createAuthService(deps: AuthDeps) {
  const { prisma, throttle, now } = deps;

  /** Self-registration always creates an APPLICANT; staff accounts are created by an administrator. */
  async function register(input: RegisterBody): Promise<PublicUser> {
    const password_hash = await hashPassword(input.password, deps.hashParams ?? DEFAULT_SCRYPT);
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            display_name: input.display_name,
            role: 'APPLICANT',
            password_hash,
          },
          select: { id: true, email: true, display_name: true, role: true },
        });
        await recordAudit(tx, {
          type: 'USER_REGISTERED',
          actor: { userId: user.id, role: 'APPLICANT' },
          details: { user_id: user.id },
        });
        return user;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw conflict('EMAIL_TAKEN', 'An account with this e-mail already exists');
      throw err;
    }
  }

  /** Officer self-registration, allowed only with the bank's enrollment code (constant-time compare, throttled). */
  async function registerStaff(input: StaffRegisterBody, client: string): Promise<PublicUser> {
    const expected = deps.staffEnrollmentCode;
    if (!expected)
      throw new HttpError(
        503,
        'STAFF_REGISTRATION_DISABLED',
        'Officer registration is not enabled. Contact your administrator.',
      );
    const key = `staff-register|${client}`;
    const wait = throttle.retryAfterSeconds(key);
    if (wait > 0) throw tooManyRequests(`Too many failed attempts. Try again in ${wait} seconds.`);
    const given = Buffer.from(input.enrollment_code);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throttle.recordFailure(key);
      await recordAudit(prisma, {
        type: 'LOGIN_FAILED',
        actor: ANONYMOUS,
        details: { email: input.email, reason: 'BAD_ENROLLMENT_CODE' },
      });
      throw new HttpError(403, 'INVALID_ENROLLMENT_CODE', 'The enrollment code is not valid');
    }
    throttle.clear(key);
    const password_hash = await hashPassword(input.password, deps.hashParams ?? DEFAULT_SCRYPT);
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email,
            display_name: input.display_name,
            role: input.role,
            password_hash,
          },
          select: { id: true, email: true, display_name: true, role: true },
        });
        await recordAudit(tx, {
          type: 'USER_REGISTERED',
          actor: { userId: user.id, role: input.role },
          details: { user_id: user.id, role: input.role },
        });
        return user;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw conflict('EMAIL_TAKEN', 'An account with this e-mail already exists');
      throw err;
    }
  }

  async function login(input: LoginBody, client: string): Promise<LoginResult> {
    const key = `${client}|${input.email}`;
    const wait = throttle.retryAfterSeconds(key);
    if (wait > 0) throw tooManyRequests(`Too many failed attempts. Try again in ${wait} seconds.`);

    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const passwordOk =
      user?.password_hash && user.is_active
        ? await verifyPassword(input.password, user.password_hash)
        : (await burnPasswordCheck(input.password), false);

    if (!user || !passwordOk) {
      throttle.recordFailure(key);
      // The attempted e-mail is recorded; the password never is.
      await recordAudit(prisma, {
        type: 'LOGIN_FAILED',
        actor: user ? { userId: user.id, role: user.role } : ANONYMOUS,
        details: { email: input.email },
      });
      throw INVALID_CREDENTIALS();
    }

    throttle.clear(key);
    const token = newSessionToken();
    const expires = new Date(now().getTime() + deps.sessionTtlMinutes * 60_000);
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { user_id: user.id, expires_at: { lt: now() } } });
      await tx.session.create({
        data: {
          user_id: user.id,
          token_hash: hashSessionToken(token, deps.sessionSecret),
          expires_at: expires,
        },
      });
      await recordAudit(tx, {
        type: 'LOGIN_SUCCEEDED',
        actor: { userId: user.id, role: user.role },
      });
    });
    return {
      token,
      token_type: 'Bearer',
      expires_at: expires.toISOString(),
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    };
  }

  /** Resolves a bearer token to its user, or throws 401. The same error for every failure. */
  async function authenticate(token: string): Promise<AuthContext> {
    const session = await prisma.session.findUnique({
      where: { token_hash: hashSessionToken(token, deps.sessionSecret) },
      include: { user: true },
    });
    const valid =
      session && !session.revoked_at && session.expires_at > now() && session.user.is_active;
    if (!valid) throw unauthorized('Invalid or expired session');
    return {
      userId: session.user.id,
      role: session.user.role,
      email: session.user.email,
      displayName: session.user.display_name,
      sessionId: session.id,
    };
  }

  async function logout(auth: AuthContext): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.session.updateMany({
        where: { id: auth.sessionId, revoked_at: null },
        data: { revoked_at: now() },
      });
      await recordAudit(tx, { type: 'LOGOUT', actor: actorOf(auth) });
    });
  }

  return { register, registerStaff, login, authenticate, logout };
}

export type AuthService = ReturnType<typeof createAuthService>;
