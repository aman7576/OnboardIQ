// Measures an extractor against the supplied truth file. The truth is used ONLY here, to score predictions:
// no extractor ever receives it, and declared_doc_type is not an input either.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { collapse } from './text.js';
import { DOC_TYPES } from './validators.js';

export interface DocSample {
  docId: string;
  applicationId: string;
  text: string;
  truth: Record<string, string>; // doc_type + the fields that apply (empty values removed)
  poor: boolean; // scan quality, see isPoorScan
}

/** The one line every clean specimen contains; a poor scan has it damaged. Used only to split the report. */
const CANONICAL = 'SYNTHETIC SPECIMEN - NOT A VALID DOCUMENT';
export const isPoorScan = (text: string): boolean =>
  !text.split(/\r?\n/).some((l) => l.trim() === CANONICAL);

export function loadSamples(dir: string): DocSample[] {
  const truth = new Map(
    (
      parse(readFileSync(join(dir, 'case_02_document_truth_sample_V1.0.csv'), 'utf8'), {
        columns: true,
        skip_empty_lines: true,
      }) as Record<string, string>[]
    ).map((r) => [
      r.doc_id as string,
      Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== 'doc_id' && v !== '')),
    ]),
  );
  return readFileSync(join(dir, 'case_02_document_text_sample_V1.0.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      const o = JSON.parse(l) as { doc_id: string; application_id: string; text: string };
      return {
        docId: o.doc_id,
        applicationId: o.application_id,
        text: o.text,
        truth: truth.get(o.doc_id) ?? {},
        poor: isPoorScan(o.text),
      };
    });
}

export interface Prediction {
  docType: string;
  docTypeConfidence: number;
  fields: { name: string; value: string; confidence: number }[];
}

/** Spec AI-2: name and address are compared upper case with spaces collapsed; everything else exactly. */
export const normaliseForCompare = (field: string, value: string): string =>
  field === 'name' || field === 'address' ? collapse(value).toUpperCase() : value.trim();

export interface Ratio {
  correct: number;
  total: number;
  rate: number | null;
}
const ratio = (correct: number, total: number): Ratio => ({
  correct,
  total,
  rate: total === 0 ? null : correct / total,
});

export interface Metrics {
  documents: number;
  classification: {
    overall: Ratio;
    clean: Ratio;
    poor: Ratio;
    confusion: Record<string, Record<string, number>>;
    accurateWhenConfident: Ratio;
  };
  fields: {
    overall: Ratio;
    clean: Ratio;
    poor: Ratio;
    byField: Record<string, Ratio>;
    cleanByField: Record<string, Ratio>;
    poorByField: Record<string, Ratio>;
  };
  confidence: {
    threshold: number;
    accepted: Ratio; // precision of fields accepted at >= threshold
    sentToReview: Ratio; // how many of the fields below the threshold were actually right
    coverage: Ratio; // share of all truth fields that were accepted
    correctSentToReview: number; // right values that still went to a person
  };
  injectionAsOther: { checked: number; classifiedOther: number };
}

/** Counts right and total answers. */
class Tally {
  correct = 0;
  total = 0;
  add(right: boolean): void {
    this.total++;
    if (right) this.correct++;
  }
  ratio(): Ratio {
    return ratio(this.correct, this.total);
  }
}

const tallies = (): Record<string, Tally> =>
  new Proxy({} as Record<string, Tally>, { get: (t, k: string) => (t[k] ??= new Tally()) });

export function evaluateExtractor(
  samples: DocSample[],
  predict: (s: DocSample) => Prediction,
  threshold = 0.8,
): Metrics {
  const confusion: Record<string, Record<string, number>> = Object.fromEntries(
    DOC_TYPES.map((t) => [t, Object.fromEntries(DOC_TYPES.map((p) => [p, 0]))]),
  );
  const cls = { all: new Tally(), clean: new Tally(), poor: new Tally(), confident: new Tally() };
  const field = { all: new Tally(), clean: new Tally(), poor: new Tally() };
  const byField = { all: tallies(), clean: tallies(), poor: tallies() };
  const accepted = new Tally();
  const review = new Tally();
  let truthFields = 0;

  for (const s of samples) {
    const p = predict(s);
    const truthType = s.truth.doc_type ?? 'OTHER';
    const row = confusion[truthType];
    if (row) row[p.docType] = (row[p.docType] ?? 0) + 1;
    const typeRight = p.docType === truthType;
    const quality = s.poor ? 'poor' : 'clean';
    cls.all.add(typeRight);
    cls[quality].add(typeRight);
    if (p.docTypeConfidence >= threshold) cls.confident.add(typeRight);

    for (const [name, want] of Object.entries(s.truth)) {
      if (name === 'doc_type') continue;
      const got = typeRight ? p.fields.find((f) => f.name === name) : undefined;
      const right =
        got !== undefined &&
        normaliseForCompare(name, got.value) === normaliseForCompare(name, want);
      field.all.add(right);
      field[quality].add(right);
      byField.all[name]?.add(right);
      byField[quality][name]?.add(right);
      truthFields++;
      if (got && got.confidence >= threshold) accepted.add(right);
      else if (got) review.add(right);
    }
  }

  const toMap = (m: Record<string, Tally>): Record<string, Ratio> =>
    Object.fromEntries(Object.entries(m).map(([k, t]) => [k, t.ratio()]));
  const injected = samples.filter((s) => /ignore all previous instructions/i.test(s.text));
  return {
    documents: samples.length,
    classification: {
      overall: cls.all.ratio(),
      clean: cls.clean.ratio(),
      poor: cls.poor.ratio(),
      confusion,
      accurateWhenConfident: cls.confident.ratio(),
    },
    fields: {
      overall: field.all.ratio(),
      clean: field.clean.ratio(),
      poor: field.poor.ratio(),
      byField: toMap(byField.all),
      cleanByField: toMap(byField.clean),
      poorByField: toMap(byField.poor),
    },
    confidence: {
      threshold,
      accepted: accepted.ratio(),
      sentToReview: review.ratio(),
      coverage: ratio(accepted.total, truthFields),
      correctSentToReview: review.correct,
    },
    injectionAsOther: {
      checked: injected.length,
      classifiedOther: injected.filter((s) => predict(s).docType === 'OTHER').length,
    },
  };
}
