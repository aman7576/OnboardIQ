import { describe, expect, it } from 'vitest';
import { createMockProvider } from '../../src/modules/extraction/mock-provider.js';
import type { ExtractionProvider } from '../../src/modules/extraction/provider.js';
import { createProvider, withFallback } from '../../src/modules/extraction/providers.js';
import { REAL_DATA_DIR } from '../support/data-dir.js';
import { mockRows, realText } from '../support/real-data.js';

describe('mock provider (supplied extraction_mock files)', () => {
  const mock = createMockProvider(REAL_DATA_DIR);

  it('returns exactly what the supplied file says for a document', async () => {
    const out = await mock.extract({ docId: 'D3000001', text: realText('D3000001') });
    const rows = mockRows('D3000001');
    expect(out.docType).toBe('PAN_CARD');
    expect(out.docTypeConfidence).toBe(0.97);
    expect(out.fields.map((f) => [f.name, f.value, f.confidence])).toEqual(
      rows
        .filter((r) => r.field_name !== 'doc_type')
        .map((r) => [r.field_name, r.value, Number(r.confidence)]),
    );
    expect(out.extractorVersion).toBe('mock:case_02_extraction_mock_sample_V1.0.csv');
  });

  it('finds evaluation documents too', async () => {
    const out = await mock.extract({ docId: 'D3000183', text: '' });
    expect(out.docType).toBe(mockRows('D3000183').find((r) => r.field_name === 'doc_type')?.value);
    expect(out.extractorVersion).toContain('eval');
  });

  it('keeps low-confidence misreads exactly as supplied (worked example 9)', async () => {
    const out = await mock.extract({ docId: 'D3000025', text: realText('D3000025') });
    expect(out.fields.find((f) => f.name === 'pan_number')).toEqual({
      name: 'pan_number',
      value: 'ZZTP59O12Y',
      confidence: 0.62,
    });
  });

  it('unknown document: OTHER with confidence 0.00 and no fields (spec FR-3)', async () => {
    expect(await mock.extract({ docId: 'D9999999', text: 'anything' })).toEqual({
      docType: 'OTHER',
      docTypeConfidence: 0,
      fields: [],
      extractorVersion: 'mock:unknown',
    });
  });

  it('ignores the document text completely, even instruction-like text', async () => {
    const injection = realText('D3000486');
    expect(injection).toMatch(/Ignore all previous instructions/);
    const withText = await mock.extract({ docId: 'D3000486', text: injection });
    const withoutText = await mock.extract({ docId: 'D3000486', text: '' });
    expect(withText).toEqual(withoutText);
    expect(withText.docType).toBe('OTHER');
  });

  it('takes no declared_doc_type: the input type has only docId and text', () => {
    const input = { docId: 'D3000001', text: 'x' } satisfies Parameters<
      ExtractionProvider['extract']
    >[0];
    expect(Object.keys(input).sort()).toEqual(['docId', 'text']);
  });
});

describe('timeout and fallback', () => {
  const slow: ExtractionProvider = { name: 'AI', extract: () => new Promise(() => undefined) };
  const broken: ExtractionProvider = {
    name: 'AI',
    extract: () => Promise.reject(new Error('model offline')),
  };

  it('a failing provider yields OTHER with confidence 0 and never throws', async () => {
    const logs: string[] = [];
    const out = await withFallback(broken, 1000, (m) => logs.push(m)).extract({
      docId: 'D1',
      text: 't',
    });
    expect(out).toEqual({
      docType: 'OTHER',
      docTypeConfidence: 0,
      fields: [],
      extractorVersion: 'ai:unavailable',
      degraded: true,
    });
    expect(logs[0]).toContain('model offline');
    expect(logs[0]).not.toContain('"t"'); // the document text is never logged
  });

  it('a provider that does not answer in time is cut off', async () => {
    const started = Date.now();
    const out = await withFallback(slow, 50).extract({ docId: 'D1', text: 't' });
    expect(out.degraded).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('the "ai" selection is a real provider that reads the document text', async () => {
    const out = await withFallback(createProvider('ai', REAL_DATA_DIR)).extract({
      docId: 'ANY',
      text: realText('D3000001'),
    });
    expect(out).toMatchObject({
      docType: 'PAN_CARD',
      degraded: false,
      extractorVersion: 'ai|rules=2.0.0|model=none|prompt=none',
    });
    expect(out.fields.map((f) => f.name)).toEqual(['name', 'dob', 'pan_number']);
  });

  it('a healthy provider passes through unchanged', async () => {
    const out = await withFallback(createProvider('mock', REAL_DATA_DIR)).extract({
      docId: 'D3000001',
      text: '',
    });
    expect(out).toMatchObject({ docType: 'PAN_CARD', degraded: false });
  });
});
