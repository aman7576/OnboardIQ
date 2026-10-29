import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthContext } from '../../http/auth-context.js';
import { badRequest, conflict, unprocessable } from '../../http/errors.js';
import { DECLARED_DOC_TYPES } from '../../import/rows.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import { authorizeApplication } from '../applications/applications.service.js';
import type { FileStore } from './storage.js';
import { checkAll, MIN_FILES_FIRST_UPLOAD, type IncomingFile } from './validation.js';

// Applicants add documents at submission and when a resubmission was requested.
const UPLOADABLE = ['SUBMITTED', 'RESUBMISSION_REQUESTED'] as const;

export interface StoredDocument {
  doc_id: string;
  file_name: string;
  declared_doc_type: string;
  sha256: string;
  size_bytes: number;
  duplicate: boolean;
}

export function createUploadService(
  prisma: PrismaClient,
  store: FileStore,
  now: () => Date = () => new Date(),
) {
  async function upload(
    caller: AuthContext,
    applicationId: string,
    files: IncomingFile[],
    declaredTypes: string[],
  ): Promise<{ documents: StoredDocument[]; created: number }> {
    const app = await authorizeApplication(prisma, caller, applicationId);
    if (!UPLOADABLE.some((s) => s === app.status))
      throw conflict('INVALID_STATE', `Documents cannot be added while the case is ${app.status}`);
    if (files.length === 0)
      throw badRequest('No files were uploaded', [{ field: 'files', message: 'is required' }]);
    if (declaredTypes.length !== files.length)
      throw badRequest('Each file needs a declared document type', [
        {
          field: 'declared_doc_type',
          message: `expected ${files.length} values, got ${declaredTypes.length}`,
        },
      ]);
    const typeIssues = declaredTypes.flatMap((t, i) =>
      DECLARED_DOC_TYPES.some((d) => d === t)
        ? []
        : [
            {
              field: `declared_doc_type[${i}]`,
              message: `must be one of ${DECLARED_DOC_TYPES.join(', ')}`,
            },
          ],
    );
    if (typeIssues.length)
      throw unprocessable('INVALID_DECLARED_TYPE', 'Unknown declared document type', typeIssues);

    if (
      app.status === 'RESUBMISSION_REQUESTED' &&
      app.resubmission_deadline &&
      app.resubmission_deadline < now()
    )
      throw conflict('RESUBMISSION_EXPIRED', 'The resubmission window has closed');
    // Documents added while a resubmission is requested belong to the next round and supersede earlier ones.
    const round =
      app.status === 'RESUBMISSION_REQUESTED' ? app.submission_round + 1 : app.submission_round;
    const checked = await checkAll(files);
    const existing = await prisma.document.findMany({
      where: { application_id: app.application_id },
    });
    if (existing.length === 0 && files.length < MIN_FILES_FIRST_UPLOAD)
      throw unprocessable(
        'TOO_FEW_FILES',
        `A submission needs at least ${MIN_FILES_FIRST_UPLOAD} files`,
        [{ field: 'files', message: `got ${files.length}, need ${MIN_FILES_FIRST_UPLOAD}` }],
      );

    // Same content for the same application is never stored twice: return the original document.
    const bySha = new Map(existing.map((d) => [d.sha256, d]));
    const results: StoredDocument[] = [];
    const fresh: { docId: string; index: number }[] = [];
    checked.forEach((file, i) => {
      const known = bySha.get(file.sha256);
      if (known) {
        results[i] = {
          doc_id: known.doc_id,
          file_name: known.file_name,
          declared_doc_type: known.declared_doc_type,
          sha256: known.sha256,
          size_bytes: known.size_bytes,
          duplicate: true,
        };
        return;
      }
      const docId = `D${randomBytes(8).toString('hex').toUpperCase()}`; // not guessable
      bySha.set(file.sha256, { doc_id: docId } as (typeof existing)[number]);
      fresh.push({ docId, index: i });
      results[i] = {
        doc_id: docId,
        file_name: `${docId}.txt`,
        declared_doc_type: declaredTypes[i] as string,
        sha256: file.sha256,
        size_bytes: file.bytes.length,
        duplicate: false,
      };
    });

    const keys: string[] = [];
    try {
      for (const { docId, index } of fresh)
        keys.push(
          await store.save(
            app.application_id,
            docId,
            (checked[index] as (typeof checked)[number]).bytes,
          ),
        );
      await prisma.$transaction(async (tx) => {
        for (const { docId, index } of fresh) {
          const file = checked[index] as (typeof checked)[number];
          await tx.document.create({
            data: {
              doc_id: docId,
              application_id: app.application_id,
              file_name: `${docId}.txt`,
              declared_doc_type: declaredTypes[index] as (typeof DECLARED_DOC_TYPES)[number],
              text: file.text,
              sha256: file.sha256,
              size_bytes: file.bytes.length,
              dataset: app.dataset,
              uploaded_by: caller.userId,
              submission_round: round,
            },
          });
          await recordAudit(tx, {
            type: 'DOCUMENT_UPLOADED',
            actor: actorOf(caller),
            applicationId: app.application_id,
            docId,
            details: {
              declared_doc_type: declaredTypes[index] as string,
              sha256: file.sha256,
              size_bytes: file.bytes.length,
            },
          });
        }
      });
    } catch (err) {
      await Promise.all(keys.map((k) => store.remove(k).catch(() => undefined)));
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw conflict('DUPLICATE_FILE', 'An identical file was just uploaded; retry');
      throw err;
    }
    return { documents: results, created: fresh.length };
  }

  return { upload };
}

export type UploadService = ReturnType<typeof createUploadService>;
