import type { PrismaClient } from '@prisma/client';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import multer, { MulterError } from 'multer';
import { callerOf } from '../../http/auth-context.js';
import { badRequest, unprocessable } from '../../http/errors.js';
import { requireRole } from '../auth/guards.js';
import type { UploadService } from './upload.service.js';
import { MAX_UPLOAD_BYTES } from './validation.js';

// Files stay in memory (at most ~1 MB each, 20 per request) until validated; nothing is trusted yet.
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 20, fields: 40, parts: 80 },
}).array('files', 20);

function parseMultipart(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    parser(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE')
        return reject(
          unprocessable('FILE_TOO_LARGE', 'File is larger than 1 MB', [
            { field: 'files', message: 'FILE_TOO_LARGE' },
          ]),
        );
      reject(
        badRequest('Malformed upload', [
          {
            field: 'files',
            message: err instanceof Error ? err.message : 'invalid multipart body',
          },
        ]),
      );
    });
  });
}

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];

export function uploadRouter(
  prisma: PrismaClient,
  authenticate: RequestHandler,
  uploads: UploadService,
): Router {
  const router = Router();

  // multipart/form-data: repeated "files" parts and one "declared_doc_type" value per file, same order.
  router.post(
    '/:applicationId/documents',
    authenticate,
    requireRole(prisma, 'APPLICANT'),
    async (req, res) => {
      await parseMultipart(req, res);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const result = await uploads.upload(
        callerOf(req),
        String(req.params.applicationId),
        files,
        asList((req.body as Record<string, unknown> | undefined)?.declared_doc_type),
      );
      res.status(result.created > 0 ? 201 : 200).json({ documents: result.documents });
    },
  );

  return router;
}
