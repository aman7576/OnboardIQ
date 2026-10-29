import { Prisma, type Document, type PrismaClient } from '@prisma/client';
import { actorOf, recordAudit, SYSTEM, type Actor } from '../audit/audit.js';
import type { AuthContext } from '../../http/auth-context.js';
import { stableUuid } from '../../import/validate.js';
import type { SafeExtractionProvider } from './provider.js';

export interface ExtractionResponse {
  doc_id: string;
  provider: 'MOCK' | 'AI';
  extractor_version: string;
  doc_type: string;
  doc_type_confidence: number;
  degraded: boolean;
  persisted: boolean;
  warnings: string[];
  fields: { field_name: string; value: string; confidence: number }[];
  /** The same data in the long format of the extraction files: doc_id, field_name, value, confidence. */
  rows: { doc_id: string; field_name: string; value: string; confidence: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function toResponse(
  docId: string,
  provider: ExtractionResponse['provider'],
  version: string,
  degraded: boolean,
  persisted: boolean,
  warnings: string[],
  rows: { field_name: string; value: string; confidence: number }[],
): ExtractionResponse {
  const docType = rows.find((r) => r.field_name === 'doc_type');
  const fields = rows
    .filter((r) => r.field_name !== 'doc_type')
    .map((r) => ({ ...r, confidence: round2(r.confidence) }));
  return {
    doc_id: docId,
    provider,
    extractor_version: version,
    doc_type: docType?.value ?? 'OTHER',
    doc_type_confidence: round2(docType?.confidence ?? 0),
    degraded,
    persisted,
    warnings,
    fields,
    rows: [
      {
        doc_id: docId,
        field_name: 'doc_type',
        value: docType?.value ?? 'OTHER',
        confidence: round2(docType?.confidence ?? 0),
      },
      ...fields.map((f) => ({ doc_id: docId, ...f })),
    ],
  };
}

export function createExtractionService(prisma: PrismaClient, provider: SafeExtractionProvider) {
  /** Spec FR-3: a document the provider does not know is OTHER with confidence 0.00 (nothing is stored). */
  function unknown(docId: string): ExtractionResponse {
    return toResponse(
      docId,
      provider.name,
      `${provider.name.toLowerCase()}:unknown`,
      false,
      false,
      [],
      [{ field_name: 'doc_type', value: 'OTHER', confidence: 0 }],
    );
  }

  /** Runs the provider on a stored document and persists the result once per provider version. */
  async function extractDocument(
    doc: Document,
    caller: AuthContext | null,
  ): Promise<ExtractionResponse> {
    const out = await provider.extract({ docId: doc.doc_id, text: doc.text });
    const rows = [
      { field_name: 'doc_type', value: out.docType, confidence: out.docTypeConfidence },
      ...out.fields.map((f) => ({ field_name: f.name, value: f.value, confidence: f.confidence })),
    ];
    const actor: Actor = caller ? actorOf(caller) : SYSTEM;
    const id = stableUuid(doc.doc_id, provider.name, out.extractorVersion);

    const store = async () =>
      prisma.$transaction(async (tx) => {
        const existing = await tx.extraction.findUnique({
          where: {
            doc_id_provider_extractor_version: {
              doc_id: doc.doc_id,
              provider: provider.name,
              extractor_version: out.extractorVersion,
            },
          },
          include: { fields: true },
        });
        if (existing) return existing.fields; // already stored for this provider version: idempotent
        await tx.extraction.create({
          data: {
            id,
            doc_id: doc.doc_id,
            provider: provider.name,
            extractor_version: out.extractorVersion,
          },
        });
        await tx.extractedField.createMany({
          data: rows.map((r) => ({
            id: stableUuid(id, r.field_name),
            extraction_id: id,
            doc_id: doc.doc_id,
            field_name: r.field_name,
            value: r.value,
            confidence: r.confidence,
            source: 'EXTRACTOR' as const,
          })),
        });
        await recordAudit(tx, {
          type: 'EXTRACTION_RECORDED',
          actor,
          applicationId: doc.application_id,
          docId: doc.doc_id,
          details: {
            provider: provider.name,
            extractor_version: out.extractorVersion,
            doc_type: out.docType,
            degraded: out.degraded,
          },
        });
        return tx.extractedField.findMany({ where: { extraction_id: id } });
      });

    let stored;
    try {
      stored = await store();
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      stored = await store(); // a concurrent call stored it first
    }
    const ordered = [...stored].sort((a, b) =>
      a.field_name === 'doc_type'
        ? -1
        : b.field_name === 'doc_type'
          ? 1
          : a.field_name.localeCompare(b.field_name),
    );
    return toResponse(
      doc.doc_id,
      provider.name,
      out.extractorVersion,
      out.degraded,
      true,
      out.warnings ?? [],
      ordered.map((r) => ({
        field_name: r.field_name,
        value: r.value,
        confidence: Number(r.confidence),
      })),
    );
  }

  return { extractDocument, unknown };
}

export type ExtractionService = ReturnType<typeof createExtractionService>;
