// Append-only audit writes. Callers pass the transaction client so the audit row commits or
// rolls back together with the change it describes (FR-9). No update/delete helper exists, and the
// database trigger blocks them as well.
import type { AuditEventType, Prisma, PrismaClient, Role } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';

export type Db = PrismaClient | Prisma.TransactionClient;

export interface Actor {
  userId: string | null;
  role: Role | 'SYSTEM' | 'ANONYMOUS';
}

export const actorOf = (auth: AuthContext): Actor => ({ userId: auth.userId, role: auth.role });
export const SYSTEM: Actor = { userId: null, role: 'SYSTEM' };
export const ANONYMOUS: Actor = { userId: null, role: 'ANONYMOUS' };

export interface AuditInput {
  type: AuditEventType;
  actor: Actor;
  applicationId?: string | null;
  docId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  details?: Prisma.InputJsonValue;
}

/** Never put passwords, tokens, full PAN or document text in before/after/details. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      event_type: input.type,
      actor_user_id: input.actor.userId,
      actor_role: input.actor.role,
      application_id: input.applicationId ?? null,
      doc_id: input.docId ?? null,
      ...(input.before !== undefined ? { before: input.before } : {}),
      ...(input.after !== undefined ? { after: input.after } : {}),
      ...(input.details !== undefined ? { details: input.details } : {}),
    },
  });
}
