// Mock provider (spec FR-3): looks the document up by doc_id in the supplied extraction_mock files.
// A document that is not in them is reported as OTHER with confidence 0.00. The document text is
// never read or interpreted, so text inside a document cannot influence the result.
import { COLUMNS, datasetFiles } from '../../import/manifest.js';
import { readCsv } from '../../import/read.js';
import type { ExtractionProvider } from './provider.js';

interface MockEntry {
  file: string;
  docType: string;
  docTypeConfidence: number;
  fields: { name: string; value: string; confidence: number }[];
}

function loadMockFiles(dir: string): Map<string, MockEntry> {
  const entries = new Map<string, MockEntry>();
  for (const dataset of ['SAMPLE', 'EVAL'] as const) {
    const file = datasetFiles(dataset).extractionMock;
    const source = readCsv(dir, file, COLUMNS.extractionMock);
    if (source.rejections.length)
      throw new Error(`mock extraction file unusable: ${source.rejections[0]?.reason}`);
    for (const { values } of source.rows) {
      const docId = values.doc_id as string;
      const entry = entries.get(docId) ?? {
        file,
        docType: 'OTHER',
        docTypeConfidence: 0,
        fields: [],
      };
      const confidence = Number(values.confidence);
      if (values.field_name === 'doc_type') {
        entry.docType = values.value as string;
        entry.docTypeConfidence = confidence;
      } else {
        entry.fields.push({
          name: values.field_name as string,
          value: values.value as string,
          confidence,
        });
      }
      entries.set(docId, entry);
    }
  }
  return entries;
}

export function createMockProvider(dataDir: string): ExtractionProvider {
  let loaded: Map<string, MockEntry> | undefined;
  return {
    name: 'MOCK',
    extract({ docId }) {
      try {
        loaded ??= loadMockFiles(dataDir);
        const entry = loaded.get(docId);
        if (!entry)
          return Promise.resolve({
            docType: 'OTHER',
            docTypeConfidence: 0,
            fields: [],
            extractorVersion: 'mock:unknown',
          });
        return Promise.resolve({
          docType: entry.docType,
          docTypeConfidence: entry.docTypeConfidence,
          fields: entry.fields,
          extractorVersion: `mock:${entry.file}`,
        });
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}
