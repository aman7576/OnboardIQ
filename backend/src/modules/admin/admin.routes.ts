// Compliance Officer: maintain rule configuration and watchlists (spec section 3). Every change
// is audited with before/after in the same transaction.
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { callerOf } from '../../http/auth-context.js';
import { conflict, notFound } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { rowHash } from '../../import/read.js';
import { pepRow, rulesConfig, sanctionsRow } from '../../import/rows.js';
import { actorOf, recordAudit } from '../audit/audit.js';
import { requireRole } from '../auth/guards.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DashboardService } from './dashboard.service.js';
import type { MaintenanceService } from '../workflow/maintenance.service.js';
import type { ProcessingService } from '../workflow/processing.service.js';

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const ENTRY_ID = /^[A-Za-z0-9_-]{1,20}$/;

// Same validation as the importer; optional fields may be omitted instead of sent as "".
const text = z.string().max(300);
const sanctionsBody = z.strictObject({
  list_id: text,
  name: text,
  alias: text.optional(),
  dob: text.optional(),
  nationality: text,
  program: text,
});
const pepBody = z.strictObject({
  pep_id: text,
  name: text,
  dob: text,
  position: text,
  category: text,
});

export interface AdminOps {
  maintenance: MaintenanceService;
  processing: ProcessingService;
  dashboard: DashboardService;
  outputDir: string;
}

export function adminRouter(
  prisma: PrismaClient,
  authenticate: RequestHandler,
  ops: AdminOps,
): Router {
  const router = Router();
  router.use(authenticate, requireRole(prisma, 'COMPLIANCE_OFFICER'));

  router.get('/rule-config', async (_req, res) => {
    const active = await prisma.ruleConfig.findFirst({ where: { is_active: true } });
    if (!active) throw notFound('No active rule configuration');
    res.json({
      id: active.id,
      version: active.version,
      loaded_at: active.loaded_at,
      config: active.config,
    });
  });

  // Replaces the active configuration with a new version; the old row is kept for history.
  router.put('/rule-config', async (req, res) => {
    const caller = callerOf(req);
    const config = parse(rulesConfig, req.body);
    const sha = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (await prisma.ruleConfig.findUnique({ where: { source_sha256: sha } }))
      throw conflict('CONFIG_UNCHANGED', 'This configuration already exists');
    const created = await prisma.$transaction(async (tx) => {
      const previous = await tx.ruleConfig.findFirst({ where: { is_active: true } });
      await tx.ruleConfig.updateMany({ where: { is_active: true }, data: { is_active: false } });
      const row = await tx.ruleConfig.create({
        data: {
          version: config.version,
          config: config as Prisma.InputJsonObject,
          source_file: 'api',
          source_sha256: sha,
          is_active: true,
        },
      });
      await recordAudit(tx, {
        type: 'CONFIG_CHANGED',
        actor: actorOf(caller),
        before: { rule_config_id: previous?.id ?? null, version: previous?.version ?? null },
        after: { rule_config_id: row.id, version: row.version },
        details: { target: 'rule_config' },
      });
      return row;
    });
    res.status(201).json({ id: created.id, version: created.version });
  });

  router.get('/watchlists/sanctions', async (_req, res) => {
    const rows = await prisma.sanctionsEntry.findMany({ orderBy: { list_id: 'asc' } });
    res.json({
      entries: rows.map(({ source_row_hash: _h, dob, ...r }) => ({ ...r, dob: day(dob) })),
    });
  });

  router.post('/watchlists/sanctions', async (req, res) => {
    const caller = callerOf(req);
    const body = parse(sanctionsBody, req.body);
    const values = {
      list_id: body.list_id,
      name: body.name,
      alias: body.alias ?? '',
      dob: body.dob ?? '',
      nationality: body.nationality,
      program: body.program,
    };
    const entry = parse(sanctionsRow, values);
    if (await prisma.sanctionsEntry.findUnique({ where: { list_id: entry.list_id } }))
      throw conflict('ENTRY_EXISTS', `${entry.list_id} already exists`);
    await prisma.$transaction(async (tx) => {
      await tx.sanctionsEntry.create({ data: { ...entry, source_row_hash: rowHash(values) } });
      await recordAudit(tx, {
        type: 'CONFIG_CHANGED',
        actor: actorOf(caller),
        after: { list_id: entry.list_id },
        details: { target: 'sanctions_list', action: 'ADD' },
      });
    });
    res.status(201).json({ list_id: entry.list_id });
  });

  router.delete('/watchlists/sanctions/:id', async (req, res) => {
    const caller = callerOf(req);
    const id = String(req.params.id);
    const existing = ENTRY_ID.test(id)
      ? await prisma.sanctionsEntry.findUnique({ where: { list_id: id } })
      : null;
    if (!existing) throw notFound('Watchlist entry not found');
    await prisma.$transaction(async (tx) => {
      await tx.sanctionsEntry.delete({ where: { list_id: id } });
      await recordAudit(tx, {
        type: 'CONFIG_CHANGED',
        actor: actorOf(caller),
        before: { list_id: id },
        details: { target: 'sanctions_list', action: 'REMOVE' },
      });
    });
    res.status(204).end();
  });

  router.get('/watchlists/pep', async (_req, res) => {
    const rows = await prisma.pepEntry.findMany({ orderBy: { pep_id: 'asc' } });
    res.json({
      entries: rows.map(({ source_row_hash: _h, dob, ...r }) => ({ ...r, dob: day(dob) })),
    });
  });

  router.post('/watchlists/pep', async (req, res) => {
    const caller = callerOf(req);
    const values = parse(pepBody, req.body);
    const entry = parse(pepRow, values);
    if (await prisma.pepEntry.findUnique({ where: { pep_id: entry.pep_id } }))
      throw conflict('ENTRY_EXISTS', `${entry.pep_id} already exists`);
    await prisma.$transaction(async (tx) => {
      await tx.pepEntry.create({ data: { ...entry, source_row_hash: rowHash(values) } });
      await recordAudit(tx, {
        type: 'CONFIG_CHANGED',
        actor: actorOf(caller),
        after: { pep_id: entry.pep_id },
        details: { target: 'pep_list', action: 'ADD' },
      });
    });
    res.status(201).json({ pep_id: entry.pep_id });
  });

  router.delete('/watchlists/pep/:id', async (req, res) => {
    const caller = callerOf(req);
    const id = String(req.params.id);
    const existing = ENTRY_ID.test(id)
      ? await prisma.pepEntry.findUnique({ where: { pep_id: id } })
      : null;
    if (!existing) throw notFound('Watchlist entry not found');
    await prisma.$transaction(async (tx) => {
      await tx.pepEntry.delete({ where: { pep_id: id } });
      await recordAudit(tx, {
        type: 'CONFIG_CHANGED',
        actor: actorOf(caller),
        before: { pep_id: id },
        details: { target: 'pep_list', action: 'REMOVE' },
      });
    });
    res.status(204).end();
  });

  // Audit trail of one application (full history, oldest first). Compliance Officer only. ?format=csv exports it.
  router.get('/audit/:applicationId', async (req, res) => {
    const id = String(req.params.applicationId);
    const events = /^[A-Za-z0-9_-]{1,40}$/.test(id)
      ? await prisma.auditEvent.findMany({
          where: { application_id: id },
          orderBy: { id: 'asc' },
          take: 2000,
        })
      : [];
    const userIds = [
      ...new Set(events.map((e) => e.actor_user_id).filter((u): u is string => u !== null)),
    ];
    const users = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, display_name: true, email: true },
        })
      ).map((u) => [u.id, u]),
    );
    const rows = events.map((e) => ({
      id: e.id.toString(),
      type: e.event_type,
      at: e.created_at.toISOString(),
      actor_user_id: e.actor_user_id,
      actor_name: e.actor_user_id ? (users.get(e.actor_user_id)?.display_name ?? null) : null,
      actor_role: e.actor_role,
      doc_id: e.doc_id,
      before: e.before,
      after: e.after,
      details: e.details,
    }));
    if (req.query.format === 'csv') {
      const cell = (v: unknown) => {
        const t =
          v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const cols = [
        'id',
        'at',
        'type',
        'actor_role',
        'actor_name',
        'doc_id',
        'before',
        'after',
        'details',
      ] as const;
      res
        .set('Content-Type', 'text/csv; charset=utf-8')
        .set('Content-Disposition', `attachment; filename="audit_${id}.csv"`);
      res.send(
        [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') +
          '\n',
      );
      return;
    }
    res.json({ events: rows });
  });

  // Maintenance (spec FR-8, section 3): re-screen open cases after a list change, close overdue resubmissions,
  // list customers whose re-KYC is due.
  router.post('/rescreen', async (req, res) => {
    res.json(await ops.maintenance.rescreenOpenCases(callerOf(req)));
  });

  router.post('/process-received', async (req, res) => {
    res.json(await ops.processing.processReceived(callerOf(req)));
  });

  router.post('/expire-overdue', async (req, res) => {
    res.json({ expired: await ops.processing.expireOverdue(actorOf(callerOf(req))) });
  });

  router.get('/rekyc-due', async (req, res) => {
    const { days } = parse(
      z.strictObject({ days: z.coerce.number().int().min(0).max(36_500).default(30) }),
      req.query,
    );
    res.json({ days, customers: await ops.maintenance.rekycDue(days) });
  });

  // FR-10 dashboard: real aggregates for an optional application_date range.
  router.get('/dashboard', async (req, res) => {
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
      .refine((v) => !Number.isNaN(Date.parse(v)), 'is not a real date');
    const range = parse(z.strictObject({ from: date.optional(), to: date.optional() }), req.query);
    res.json(
      await ops.dashboard.summary({
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
      }),
    );
  });

  // AI evaluation results: the files written by `npm run outputs`, served as they are (nothing is computed here).
  router.get('/ai-evaluation', (_req, res) => {
    const read = (name: string) => {
      const path = join(ops.outputDir, name);
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    };
    const metrics = read('evaluation_metrics.json');
    const report = read('evaluation_report.md');
    const card = read('model_card.md');
    if (!metrics || !report || !card)
      throw notFound('Evaluation results have not been generated yet. Run `npm run outputs`.');
    res.json({
      metrics: JSON.parse(metrics) as unknown,
      report_markdown: report,
      model_card_markdown: card,
      files: [
        ['evaluation_metrics.json', metrics],
        ['evaluation_report.md', report],
        ['model_card.md', card],
      ].map(([name, text]) => ({
        name,
        bytes: Buffer.byteLength(text as string),
        sha256: createHash('sha256')
          .update(text as string)
          .digest('hex'),
      })),
    });
  });

  return router;
}
