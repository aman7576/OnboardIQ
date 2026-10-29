import type { PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/auth-context.js';
import { badRequest, HttpError, tooManyRequests } from '../../http/errors.js';
import { requireRole } from '../auth/guards.js';
import type { ChatClient } from './chat.client.js';

const CHAT_TIMEOUT_MS = 20_000;
const LIMIT_PER_MINUTE = 15;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1000),
      }),
    )
    .min(1)
    .max(12),
});

const GUIDE = `You are "IQ", the friendly assistant robot of OnboardIQ, a bank's KYC (know-your-customer) onboarding portal.
You talk only to applicants. Always reply in clear, simple English, even if the applicant writes in Hindi or Hinglish. Keep answers short (under 120 words), clear and kind. Use plain text, no markdown.

What you can help with:
- Documents: PAN card, Aadhaar card and one address proof (electricity bill, bank statement or driving licence). A first submission needs at least 3 files. Files may be .txt, .pdf, .png or .jpg, at most 1 MB each. Photos and scanned PDFs are read automatically with OCR, so ask for sharp, straight, well-lit photos.
- Process: Submitted, then automatic checks by rules, then a KYC Officer reviews unclear cases, then a Compliance Officer approves or rejects (maker-checker). If something is missing the bank may ask for a resubmission with a deadline.
- The applicant's own application status (given below). Explain what a status means and what to do next. Use only the statuses listed below; never invent details about the case.

Strict rules:
- You do NOT decide, predict or promise approval or rejection. Decisions are made by rules and human officers. Say so if asked.
- Never ask for or repeat full Aadhaar numbers, PAN numbers, passwords or OTPs. Tell the applicant not to type them in the chat.
- If asked about anything unrelated to this portal, politely say you can only help with the KYC application.
- If you do not know, say so and suggest contacting the bank branch.`;

const STATUS_HELP: Record<string, string> = {
  SUBMITTED: 'received, waiting for automatic checks; documents can still be added',
  EXTRACTING: 'documents are being read by the system right now',
  AUTO_APPROVED: 'passed the automatic rule checks; no officer action was needed',
  IN_REVIEW: 'a KYC Officer is reviewing it',
  PENDING_CHECKER: 'waiting for the Compliance Officer final decision',
  RESUBMISSION_REQUESTED: 'the bank asked for more or better documents before the deadline',
  APPROVED: 'approved',
  REJECTED: 'rejected by an officer',
  AUTO_REJECTED: 'rejected by the automatic checks',
  CLOSED_EXPIRED: 'closed because the resubmission deadline passed',
};

/** POST /api/v1/chat. Applicants only. The model sees the chat and the caller's own application statuses, nothing else. */
export function chatRouter(deps: {
  prisma: PrismaClient;
  authenticate: RequestHandler;
  chat: ChatClient | undefined;
  now: () => Date;
}): Router {
  const router = Router();
  const hits = new Map<string, number[]>(); // user id -> request times in the last minute

  router.post('/', deps.authenticate, requireRole(deps.prisma, 'APPLICANT'), async (req, res) => {
    const caller = callerOf(req);
    if (!deps.chat)
      throw new HttpError(503, 'CHAT_DISABLED', 'The assistant is not configured (GROQ_API_KEY)');
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success)
      throw badRequest(
        'Invalid chat request',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    const last = parsed.data.messages[parsed.data.messages.length - 1];
    if (last?.role !== 'user') throw badRequest('The last message must come from the user');

    const t = deps.now().getTime();
    const recent = (hits.get(caller.userId) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= LIMIT_PER_MINUTE)
      throw tooManyRequests('Too many messages. Please wait a moment.');
    hits.set(caller.userId, [...recent, t]);

    // Only the caller's own applications, only id and status: no document text or personal data.
    const apps = await deps.prisma.application.findMany({
      where: { applicant_user_id: caller.userId },
      orderBy: { created_at: 'desc' },
      take: 5,
    });
    const context = apps.length
      ? apps
          .map(
            (a) =>
              `- ${a.application_id}: ${a.status} (${STATUS_HELP[a.status] ?? 'in progress'})` +
              (a.status === 'RESUBMISSION_REQUESTED' && a.resubmission_deadline
                ? `, deadline ${a.resubmission_deadline.toISOString().slice(0, 10)}`
                : ''),
          )
          .join('\n')
      : '- The applicant has no application yet.';
    const system =
      `${GUIDE}\n\nThe applicant's applications:\n${context}\n\n` +
      'Reminder: reply in English only, never in Hindi or Hinglish. ' +
      'Say only what the status description above says; do not add claims such as the account being active.';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    try {
      res.json({ reply: await deps.chat.reply(system, parsed.data.messages, controller.signal) });
    } catch {
      throw new HttpError(502, 'CHAT_UNAVAILABLE', 'The assistant could not answer right now');
    } finally {
      clearTimeout(timer);
    }
  });
  return router;
}
