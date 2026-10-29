// Simulated core-banking service (spec section 3): returns a customer id and account number for an
// approved application. Called in-process by the checker flow, and over HTTP only with the service key.
import { randomInt } from 'node:crypto';
import type { CoreBankingAccount } from '@prisma/client';
import { conflict, notFound } from '../../http/errors.js';
import { recordAudit, SYSTEM, type Actor, type Db } from '../audit/audit.js';

const OPENABLE = ['APPROVED', 'AUTO_APPROVED'] as const;

export interface BankAccount {
  customer_id: string;
  account_number: string;
}

export async function openAccount(
  db: Db,
  applicationId: string,
  actor: Actor = SYSTEM,
): Promise<{ account: BankAccount; created: boolean }> {
  const app = await db.application.findUnique({ where: { application_id: applicationId } });
  if (!app) throw notFound('Application not found');
  if (!OPENABLE.some((s) => s === app.status))
    throw conflict(
      'NOT_APPROVED',
      `Accounts open only for approved applications (status ${app.status})`,
    );

  const existing = await db.coreBankingAccount.findUnique({
    where: { application_id: applicationId },
  });
  if (existing) return { account: pick(existing), created: false };

  const created = await db.coreBankingAccount.create({
    data: {
      application_id: applicationId,
      customer_id: `KB${randomInt(100000, 999999)}`,
      account_number: String(randomInt(501_000_000_000, 502_000_000_000)),
    },
  });
  await recordAudit(db, {
    type: 'ACCOUNT_OPENED',
    actor,
    applicationId,
    details: { customer_id: created.customer_id },
  });
  return { account: pick(created), created: true };
}

const pick = (a: CoreBankingAccount): BankAccount => ({
  customer_id: a.customer_id,
  account_number: a.account_number,
});
