// npm run db:seed-users: creates one demo account per role (two applicants, two KYC officers, two
// Compliance Officers). The password is SEED_DEMO_PASSWORD from the environment, never from code,
// and nothing is created in production. Safe to repeat.
import type { PrismaClient, Role } from '@prisma/client';
import type { Env } from '../config/env.js';
import { DEFAULT_SCRYPT, hashPassword, verifyPassword } from '../modules/auth/password.js';
import { recordAudit, SYSTEM } from '../modules/audit/audit.js';
import { stableUuid } from '../import/validate.js';
import { cliContext } from './context.js';

interface DemoUser {
  email: string;
  display_name: string;
  role: Role;
  owns?: string; // sample application this applicant owns
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    email: 'applicant1@onboardiq.test',
    display_name: 'Ravi Kumar Sharma',
    role: 'APPLICANT',
    owns: 'A2000001',
  },
  {
    email: 'applicant2@onboardiq.test',
    display_name: 'Kavya Iyer',
    role: 'APPLICANT',
    owns: 'A2000002',
  },
  {
    email: 'officer1@onboardiq.test',
    display_name: 'Anita Rao (KYC Officer)',
    role: 'KYC_OFFICER',
  },
  {
    email: 'officer2@onboardiq.test',
    display_name: 'Vikram Shah (KYC Officer)',
    role: 'KYC_OFFICER',
  },
  {
    email: 'checker1@onboardiq.test',
    display_name: 'Meera Nair (Compliance Officer)',
    role: 'COMPLIANCE_OFFICER',
  },
  {
    email: 'checker2@onboardiq.test',
    display_name: 'Sanjay Gupta (Compliance Officer)',
    role: 'COMPLIANCE_OFFICER',
  },
];

export interface SeedUsersResult {
  skipped: string | null;
  created: number;
  updated: number;
  unchanged: number;
  linkedApplications: number;
}

export async function seedDemoUsers(
  prisma: PrismaClient,
  env: Pick<Env, 'NODE_ENV' | 'SEED_DEMO_PASSWORD'>,
): Promise<SeedUsersResult> {
  const none = { created: 0, updated: 0, unchanged: 0, linkedApplications: 0 };
  if (env.NODE_ENV === 'production')
    return { ...none, skipped: 'NODE_ENV=production: demo users are never created' };
  const password = env.SEED_DEMO_PASSWORD;
  if (!password)
    return { ...none, skipped: 'SEED_DEMO_PASSWORD is not set: no demo users created' };

  const result: SeedUsersResult = { ...none, skipped: null };
  for (const demo of DEMO_USERS) {
    const existing = await prisma.user.findUnique({ where: { email: demo.email } });
    if (!existing) {
      const password_hash = await hashPassword(password, DEFAULT_SCRYPT);
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: stableUuid('demo-user', demo.email),
            email: demo.email,
            display_name: demo.display_name,
            role: demo.role,
            password_hash,
          },
        });
        await recordAudit(tx, {
          type: 'USER_REGISTERED',
          actor: SYSTEM,
          details: { user_id: user.id, seeded: true, role: demo.role },
        });
      });
      result.created++;
    } else if (
      !existing.password_hash ||
      !(await verifyPassword(password, existing.password_hash))
    ) {
      // The demo password in .env changed: bring the account in line.
      await prisma.user.update({
        where: { id: existing.id },
        data: { password_hash: await hashPassword(password, DEFAULT_SCRYPT), is_active: true },
      });
      result.updated++;
    } else {
      result.unchanged++;
    }
    if (demo.owns) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email: demo.email } });
      const linked = await prisma.application.updateMany({
        where: { application_id: demo.owns, applicant_user_id: null },
        data: { applicant_user_id: user.id },
      });
      result.linkedApplications += linked.count;
    }
  }
  return result;
}

export function formatSeedUsers(r: SeedUsersResult): string {
  if (r.skipped) return `DEMO USERS: skipped - ${r.skipped}`;
  return [
    `DEMO USERS: created ${r.created}, password updated ${r.updated}, unchanged ${r.unchanged}, applications linked ${r.linkedApplications}`,
    ...DEMO_USERS.map(
      (u) => `  ${u.email.padEnd(28)} ${u.role}${u.owns ? `  (owns ${u.owns})` : ''}`,
    ),
    '  password: the value of SEED_DEMO_PASSWORD in your .env',
  ].join('\n');
}

async function main(): Promise<number> {
  const ctx = cliContext();
  if (!ctx) return 1;
  try {
    console.log(formatSeedUsers(await seedDemoUsers(ctx.prisma, ctx.env)));
    return 0;
  } finally {
    await ctx.prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('seed-users.ts')) process.exitCode = await main();
