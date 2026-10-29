import type { PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { notFound } from '../../http/errors.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import { authorizeApplication } from './applications.service.js';
import { toDocumentList } from './views.js';

export function createDocumentsService(prisma: PrismaClient) {
  async function list(caller: AuthContext, applicationId: string) {
    const app = await authorizeApplication(prisma, caller, applicationId);
    const docs = await prisma.document.findMany({
      where: { application_id: app.application_id },
      orderBy: { doc_id: 'asc' },
    });
    return toDocumentList(docs);
  }

  /**
   * Serves the stored text to the owner or an authorised officer and records who viewed it, in the
   * same transaction as the read (FR-9). The document must belong to the application in the URL,
   * so swapping either id cannot reach someone else's file.
   */
  async function view(caller: AuthContext, applicationId: string, docId: string) {
    const app = await authorizeApplication(prisma, caller, applicationId);
    return prisma.$transaction(async (tx) => {
      const doc = await tx.document.findFirst({
        where: { doc_id: docId, application_id: app.application_id },
      });
      if (!doc) throw notFound('Document not found');
      await recordAudit(tx, {
        type: 'DOCUMENT_VIEWED',
        actor: actorOf(caller),
        applicationId: app.application_id,
        docId: doc.doc_id,
      });
      return {
        doc_id: doc.doc_id,
        file_name: doc.file_name,
        declared_doc_type: doc.declared_doc_type,
        sha256: doc.sha256,
        text: doc.text,
      };
    });
  }

  return { list, view };
}

export type DocumentsService = ReturnType<typeof createDocumentsService>;
