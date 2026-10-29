// Reads what the pure rules engine needs from the database: the active rule configuration (plus the
// occupation risk table), the watchlists, existing customers and the application's classified documents.
import type { Application } from '@prisma/client';
import { rulesConfig } from '../../import/rows.js';
import type {
  ApplicationInput,
  ClassifiedDocument,
  EngineConfig,
  ExistingCustomer,
  RiskLevel,
  Watchlists,
} from '../../rules/types.js';
import type { Db } from '../audit/audit.js';

const day = (d: Date): string => d.toISOString().slice(0, 10);

export interface EngineReference {
  config: EngineConfig;
  ruleConfigId: number;
  watchlists: Watchlists;
  existingCustomers: ExistingCustomer[];
}

/** The active rule configuration only (thresholds, patterns, SLAs), without the lists. */
export async function loadActiveConfig(db: Db): Promise<{ config: EngineConfig; id: number }> {
  const active = await db.ruleConfig.findFirst({ where: { is_active: true } });
  if (!active) throw new Error('no active rule configuration: import or publish one first');
  const occupations: Record<string, RiskLevel> = {};
  for (const o of await db.occupation.findMany()) occupations[o.occupation_code] = o.risk_level;
  return { config: { ...rulesConfig.parse(active.config), occupations }, id: active.id };
}

export async function loadReference(db: Db): Promise<EngineReference> {
  const { config, id } = await loadActiveConfig(db);
  const [sanctions, pep, customers] = await Promise.all([
    db.sanctionsEntry.findMany(),
    db.pepEntry.findMany(),
    db.existingCustomer.findMany(),
  ]);
  return {
    config,
    ruleConfigId: id,
    watchlists: {
      sanctions: sanctions.map((e) => ({
        id: e.list_id,
        name: e.name,
        alias: e.alias,
        dob: e.dob ? day(e.dob) : null,
      })),
      pep: pep.map((e) => ({ id: e.pep_id, name: e.name, alias: null, dob: day(e.dob) })),
    },
    existingCustomers: customers.map((c) => ({
      customerId: c.customer_id,
      panNumber: c.pan_number,
    })),
  };
}

export const toApplicationInput = (a: Application): ApplicationInput => ({
  applicationId: a.application_id,
  applicationDate: day(a.application_date),
  fullName: a.full_name,
  dob: day(a.dob),
  panNumber: a.pan_number,
  aadhaarLast4: a.aadhaar_last4,
  pincode: a.pincode,
  occupationCode: a.occupation_code,
  annualIncome: a.annual_income,
});

/**
 * The documents the engine sees: each document with its latest extraction. ASSUMPTION (the spec only says
 * "a resubmitted application is evaluated again"): documents uploaded in a later submission round replace
 * earlier documents declared as the same type, so a re-uploaded bill supersedes the stale one.
 */
export async function loadClassifiedDocuments(
  db: Db,
  applicationId: string,
): Promise<ClassifiedDocument[]> {
  const docs = await db.document.findMany({
    where: { application_id: applicationId },
    orderBy: { doc_id: 'asc' },
    include: {
      extractions: { orderBy: { created_at: 'desc' }, take: 1, include: { fields: true } },
    },
  });
  const newestRound = new Map<string, number>();
  for (const d of docs)
    newestRound.set(
      d.declared_doc_type,
      Math.max(newestRound.get(d.declared_doc_type) ?? 0, d.submission_round),
    );

  return docs
    .filter((d) => d.submission_round === newestRound.get(d.declared_doc_type))
    .map((d) => {
      const rows = d.extractions[0]?.fields ?? [];
      const type = rows.find((r) => r.field_name === 'doc_type');
      return {
        docId: d.doc_id,
        declaredDocType: d.declared_doc_type,
        docType: type?.value ?? 'OTHER',
        docTypeConfidence: Number(type?.confidence ?? 0),
        fields: rows
          .filter((r) => r.field_name !== 'doc_type')
          .map((r) => ({ name: r.field_name, value: r.value, confidence: Number(r.confidence) })),
      };
    });
}
