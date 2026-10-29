import type { Application, ApplicationStatus } from '@prisma/client';
import { conflict } from '../../http/errors.js';
import { recordAudit, type Actor, type Db } from '../audit/audit.js';
import type { Prisma } from '@prisma/client';
import { assertTransition } from './transitions.js';

/**
 * The only place a status changes. Optimistic locking: the UPDATE only matches if nobody changed
 * the row since it was read (version column), so of two simultaneous actions the second gets 409.
 * The audit row is written on the same transaction client.
 */
export async function changeStatus(
  tx: Db,
  app: Pick<Application, 'application_id' | 'status' | 'version'>,
  to: ApplicationStatus,
  actor: Actor,
  details?: Prisma.InputJsonValue,
): Promise<void> {
  assertTransition(app.status, to);
  const { count } = await tx.application.updateMany({
    where: { application_id: app.application_id, version: app.version },
    data: { status: to, version: { increment: 1 } },
  });
  if (count !== 1)
    throw conflict(
      'VERSION_CONFLICT',
      'The case was changed by someone else. Reload and try again.',
    );
  await recordAudit(tx, {
    type: 'STATUS_CHANGED',
    actor,
    applicationId: app.application_id,
    before: { status: app.status },
    after: { status: to },
    ...(details !== undefined ? { details } : {}),
  });
}
