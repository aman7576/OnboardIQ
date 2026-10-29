// R2: any document's classified doc_type differs from its declared_doc_type -> REVIEW
import type { Rule } from './rule.js';

export const r2: Rule = {
  id: 'R2',
  code: 'DOCUMENT_TYPE_MISMATCH',
  outcome: 'REVIEW',
  needs: ['doc_type', 'declared_doc_type'],
  test: ({ documents }) => {
    const mismatches = documents
      .filter((d) => d.docType !== d.declaredDocType)
      .map((d) => ({ docId: d.docId, declared: d.declaredDocType, classified: d.docType }));
    return { triggered: mismatches.length > 0, compared: { mismatches } };
  },
};
