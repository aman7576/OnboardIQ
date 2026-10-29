// R3: any document's doc_type confidence is below the minimum, or any required field of a selected
// document is missing or below it -> REVIEW
import { atLeast } from '../name.js';
import { REQUIRED_FIELDS } from '../context.js';
import type { Rule } from './rule.js';

export const r3: Rule = {
  id: 'R3',
  code: 'LOW_EXTRACTION_CONFIDENCE',
  outcome: 'REVIEW',
  needs: ['doc_type confidence', 'required fields of selected documents'],
  test: ({ documents, selected, usable, config }) => {
    const lowType = documents
      .filter((d) => !atLeast(d.docTypeConfidence, config.min_field_confidence))
      .map((d) => ({ docId: d.docId, docTypeConfidence: d.docTypeConfidence }));
    const unusableFields = [selected.pan, selected.aadhaar, selected.addressProof].flatMap((doc) =>
      doc
        ? (REQUIRED_FIELDS[doc.docType] ?? [])
            .filter((f) => usable(doc, f) === undefined)
            .map((f) => ({ docId: doc.docId, field: f }))
        : [],
    );
    return {
      triggered: lowType.length > 0 || unusableFields.length > 0,
      compared: {
        minFieldConfidence: config.min_field_confidence,
        lowDocTypeConfidence: lowType,
        unusableRequiredFields: unusableFields,
      },
    };
  },
};
