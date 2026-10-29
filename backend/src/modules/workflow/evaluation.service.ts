// Runs the pure engine for one application and persists the outcome: the evaluation, its screening
// matches and the audit events, on the caller's transaction client so they commit with the change.
import type {
  Application,
  EvaluationTrigger,
  ExtractionProvider,
  Prisma,
  RuleEvaluation,
} from '@prisma/client';
import { evaluate } from '../../rules/evaluate.js';
import type { ClassifiedDocument, Evaluation } from '../../rules/types.js';
import { recordAudit, type Actor, type Db } from '../audit/audit.js';
import {
  loadClassifiedDocuments,
  loadReference,
  toApplicationInput,
  type EngineReference,
} from './engine-data.js';

export const RULES_VERSION = '1.0.0'; // version of the rules code, stored with every evaluation

export interface Computed {
  evaluation: Evaluation;
  documents: ClassifiedDocument[];
  reference: EngineReference;
}

/** Reads and evaluates; writes nothing. May throw (for example an unknown occupation). */
export async function computeEvaluation(db: Db, app: Application): Promise<Computed> {
  const reference = await loadReference(db);
  const documents = await loadClassifiedDocuments(db, app.application_id);
  const evaluation = evaluate(
    toApplicationInput(app),
    documents,
    reference.config,
    reference.watchlists,
    reference.existingCustomers,
  );
  return { evaluation, documents, reference };
}

export async function storeEvaluation(
  tx: Db,
  app: Application,
  computed: Computed,
  trigger: EvaluationTrigger,
  actor: Actor,
  provider: ExtractionProvider,
): Promise<RuleEvaluation> {
  const { evaluation: e, reference } = computed;
  const row = await tx.ruleEvaluation.create({
    data: {
      application_id: app.application_id,
      trigger,
      decision: e.decision,
      reason_codes: e.reasonCodes,
      name_match_score: e.nameMatchScore,
      risk_category: e.riskCategory,
      rekyc_due_date: e.rekycDueDate ? new Date(e.rekycDueDate) : null,
      trace: JSON.parse(JSON.stringify(e.trace)) as Prisma.InputJsonValue,
      rules_version: RULES_VERSION,
      rule_config_id: reference.ruleConfigId,
      extraction_provider: provider,
    },
  });
  for (const [listType, screening] of [
    ['SANCTIONS', e.screening.sanctions],
    ['PEP', e.screening.pep],
  ] as const) {
    for (const hit of screening.hits) {
      await tx.screeningMatch.create({
        data: {
          evaluation_id: row.id,
          application_id: app.application_id,
          list_type: listType,
          entry_id: hit.entryId,
          matched_name: hit.matchedText,
          similarity: hit.similarity,
          declared_dob: app.dob,
          entry_dob: hit.entryDob ? new Date(hit.entryDob) : null,
          result: hit.result,
        },
      });
      await recordAudit(tx, {
        type: 'WATCHLIST_HIT',
        actor,
        applicationId: app.application_id,
        details: {
          evaluation_id: row.id,
          list_type: listType,
          entry_id: hit.entryId,
          similarity: hit.similarity,
          result: hit.result,
        },
      });
    }
  }
  await recordAudit(tx, {
    type: 'DECISION_RECORDED',
    actor,
    applicationId: app.application_id,
    details: {
      evaluation_id: row.id,
      trigger,
      decision: e.decision,
      reason_codes: e.reasonCodes,
      risk_category: e.riskCategory,
    },
  });
  return row;
}
