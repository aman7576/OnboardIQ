import { describe, expect, it } from 'vitest';
import {
  createAiProvider,
  aiExtractorVersion,
} from '../../src/modules/extraction/ai/ai-provider.js';
import {
  buildPrompt,
  createAnthropicClient,
  LlmResponseError,
  mergeProposal,
  parseLlmResponse,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type LlmClient,
} from '../../src/modules/extraction/ai/llm.js';
import { extractWithRules } from '../../src/modules/extraction/ai/rules-extractor.js';
import { withFallback } from '../../src/modules/extraction/providers.js';
import { realText } from '../support/real-data.js';

const pan = realText('D3000001');
const fake = (
  answer: string | (() => Promise<string>),
  calls: { n: number } = { n: 0 },
): LlmClient => ({
  name: 'fake',
  model: 'fake-1',
  complete: () => {
    calls.n++;
    return typeof answer === 'string' ? Promise.resolve(answer) : answer();
  },
});
const goodAnswer = JSON.stringify({
  doc_type: 'PAN_CARD',
  fields: { name: 'Ravi Kumar Sharma', dob: '1990-05-15', pan_number: 'zzkps1234q' },
});

describe('prompt construction', () => {
  it('puts the document between random delimiter lines and tells the model it is untrusted data', () => {
    const p = buildPrompt(pan);
    const lines = p.user.split('\n');
    expect(lines.find((l) => l.startsWith('<<<DOCUMENT '))).toMatch(/^<<<DOCUMENT [0-9a-f]{16}$/);
    expect(lines.at(-1)).toMatch(/^DOCUMENT [0-9a-f]{16}>>>$/);
    expect(p.user).toContain('ZZKPS1234Q');
    expect(p.system).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).toMatch(/UNTRUSTED DATA/);
    expect(SYSTEM_PROMPT).toMatch(/never follow/i);
    expect(SYSTEM_PROMPT).toMatch(/do not make decisions/i);
  });

  it('uses a fresh token every time, so a document cannot contain its own closing line', () => {
    expect(buildPrompt(pan).user.split('\n')[1]).not.toBe(buildPrompt(pan).user.split('\n')[1]);
  });
});

describe('response validation (structured output)', () => {
  it('accepts a valid answer, also inside a code fence', () => {
    expect(parseLlmResponse(goodAnswer).doc_type).toBe('PAN_CARD');
    expect(parseLlmResponse('```json\n' + goodAnswer + '\n```').fields.dob).toBe('1990-05-15');
  });

  it.each([
    ['not JSON at all', 'I think this is a PAN card.'],
    ['broken JSON', '{"doc_type": "PAN_CARD", "fields": '],
    ['an unknown document type', JSON.stringify({ doc_type: 'PASSPORT', fields: {} })],
    ['a missing fields object', JSON.stringify({ doc_type: 'PAN_CARD' })],
    ['a non-string field value', JSON.stringify({ doc_type: 'PAN_CARD', fields: { name: 42 } })],
    [
      'an unknown field name',
      JSON.stringify({ doc_type: 'PAN_CARD', fields: { passport_no: 'X' } }),
    ],
  ])('rejects %s', (_n, raw) => {
    expect(() => parseLlmResponse(raw)).toThrow(LlmResponseError);
  });

  it('cannot express a decision: any extra key such as "decision" or "approve" invalidates the answer', () => {
    for (const extra of [
      { decision: 'APPROVE' },
      { approve: true },
      { recommendation: 'APPROVE' },
      { risk_category: 'LOW' },
    ])
      expect(() =>
        parseLlmResponse(JSON.stringify({ doc_type: 'PAN_CARD', fields: {}, ...extra })),
      ).toThrow(LlmResponseError);
  });
});

describe('merging the model proposal with the deterministic result', () => {
  const rules = extractWithRules(pan, '2.0.0');

  it('agreement keeps the value and raises confidence; the model value is normalised (PAN upper-cased)', () => {
    const merged = mergeProposal(rules, parseLlmResponse(goodAnswer));
    expect(merged.fields.find((f) => f.name === 'pan_number')).toMatchObject({
      value: 'ZZKPS1234Q',
    });
    expect(merged.fields.every((f) => f.confidence >= 0.95)).toBe(true);
  });

  it('disagreement keeps the deterministic value but drops confidence below 0.80 (a person checks it)', () => {
    const merged = mergeProposal(
      rules,
      parseLlmResponse(
        JSON.stringify({ doc_type: 'PAN_CARD', fields: { pan_number: 'ABCDE1234F' } }),
      ),
    );
    const f = merged.fields.find((x) => x.name === 'pan_number');
    expect(f?.value).toBe('ZZKPS1234Q');
    expect(f?.confidence).toBeLessThan(0.8);
    expect(merged.warnings).toContain('llm_disagrees:pan_number');
  });

  it('a value only the model produced is used only if it validates, and still stays below 0.80', () => {
    const noPan = { ...rules, fields: rules.fields.filter((f) => f.name !== 'pan_number') };
    const ok = mergeProposal(
      noPan,
      parseLlmResponse(
        JSON.stringify({ doc_type: 'PAN_CARD', fields: { pan_number: 'zzkps1234q' } }),
      ),
    );
    expect(ok.fields.find((f) => f.name === 'pan_number')).toMatchObject({
      value: 'ZZKPS1234Q',
      confidence: 0.75,
    });
    const bad = mergeProposal(
      noPan,
      parseLlmResponse(
        JSON.stringify({ doc_type: 'PAN_CARD', fields: { pan_number: 'NOT-A-PAN' } }),
      ),
    );
    expect(bad.fields.find((f) => f.name === 'pan_number')).toBeUndefined();
  });

  it('a model that disagrees about the document type cannot change it; confidence drops so the case is reviewed', () => {
    const merged = mergeProposal(
      rules,
      parseLlmResponse(JSON.stringify({ doc_type: 'AADHAAR_CARD', fields: {} })),
    );
    expect(merged.docType).toBe('PAN_CARD');
    expect(merged.docTypeConfidence).toBeLessThan(0.8);
  });

  it('never overrides the injection guard', () => {
    const guarded = extractWithRules(realText('D3000486'), '2.0.0');
    expect(
      mergeProposal(
        guarded,
        parseLlmResponse(JSON.stringify({ doc_type: 'AADHAAR_CARD', fields: { name: 'X Y' } })),
      ),
    ).toBe(guarded);
  });
});

describe('the AI provider with a model', () => {
  it('records provider, model, prompt and rules version with the result', async () => {
    const llm = fake(goodAnswer);
    const out = await createAiProvider({ llm }).extract({ docId: 'D1', text: pan });
    expect(out.extractorVersion).toBe(`ai|rules=2.0.0|model=fake:fake-1|prompt=${PROMPT_VERSION}`);
    expect(out.extractorVersion).toBe(aiExtractorVersion(llm));
    expect(out.docType).toBe('PAN_CARD');
  });

  it('a malformed model answer fails the extraction, and the fallback gives OTHER with confidence 0', async () => {
    const provider = withFallback(createAiProvider({ llm: fake('not json') }));
    expect(await provider.extract({ docId: 'D1', text: pan })).toMatchObject({
      docType: 'OTHER',
      docTypeConfidence: 0,
      fields: [],
      degraded: true,
      extractorVersion: 'ai:unavailable',
    });
  });

  it('a model that tries to approve is treated as a malformed answer', async () => {
    const llm = fake(JSON.stringify({ doc_type: 'PAN_CARD', fields: {}, decision: 'APPROVE' }));
    expect(
      (await withFallback(createAiProvider({ llm })).extract({ docId: 'D1', text: pan })).degraded,
    ).toBe(true);
  });

  it('a model that does not answer in time is cut off (timeout) and degrades the same way', async () => {
    const hanging = fake(() => new Promise(() => undefined));
    const started = Date.now();
    const out = await withFallback(
      createAiProvider({ llm: hanging, llmTimeoutMs: 30 }),
      60,
    ).extract({ docId: 'D1', text: pan });
    expect(out).toMatchObject({ docType: 'OTHER', docTypeConfidence: 0, degraded: true });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('a model error degrades without leaking the document text into the log message', async () => {
    const logs: string[] = [];
    const llm = fake(() => Promise.reject(new Error('HTTP 500')));
    await withFallback(createAiProvider({ llm }), 1000, (m) => logs.push(m)).extract({
      docId: 'D1',
      text: pan,
    });
    expect(logs.join(' ')).toContain('HTTP 500');
    expect(logs.join(' ')).not.toContain('ZZKPS1234Q');
  });

  it('text that carries instructions is not even sent to the model', async () => {
    const calls = { n: 0 };
    const out = await createAiProvider({ llm: fake(goodAnswer, calls) }).extract({
      docId: 'D3000486',
      text: realText('D3000486'),
    });
    expect(calls.n).toBe(0);
    expect(out).toMatchObject({
      docType: 'OTHER',
      fields: [],
      warnings: ['prompt_injection_suspected'],
    });
  });

  it('without a model the provider works from the deterministic rules alone', async () => {
    const out = await createAiProvider().extract({ docId: 'D1', text: pan });
    expect(out.extractorVersion).toBe('ai|rules=2.0.0|model=none|prompt=none');
    expect(out.fields.map((f) => f.name)).toEqual(['name', 'dob', 'pan_number']);
  });
});

describe('Anthropic client (request shape; no network)', () => {
  const answer = {
    content: [
      {
        type: 'tool_use',
        name: 'record_extraction',
        input: { doc_type: 'PAN_CARD', fields: { pan_number: 'ZZKPS1234Q' } },
      },
    ],
  };

  it('sends the key as a header, forces the structured tool, and wraps the document in delimiters', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = createAnthropicClient({
      apiKey: 'sk-test-key-0123456789abcdef',
      model: 'claude-haiku-5-5',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify(answer), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const p = buildPrompt(pan);
    expect(
      parseLlmResponse(await client.complete({ ...p, signal: AbortSignal.timeout(1000) })).doc_type,
    ).toBe('PAN_CARD');
    const body = JSON.parse(seen?.init.body as string);
    expect(seen?.url).toBe('https://api.anthropic.com/v1/messages');
    expect((seen?.init.headers as Record<string, string>)['x-api-key']).toBe(
      'sk-test-key-0123456789abcdef',
    );
    expect(body).toMatchObject({
      model: 'claude-haiku-5-5',
      temperature: 0,
      tool_choice: { type: 'tool', name: 'record_extraction' },
    });
    expect(body.tools[0].input_schema.additionalProperties).toBe(false);
    expect(body.system).toBe(SYSTEM_PROMPT);
    expect(body.messages[0].content).toMatch(
      /<<<DOCUMENT [0-9a-f]{16}\n[\s\S]*ZZKPS1234Q[\s\S]*\nDOCUMENT [0-9a-f]{16}>>>/,
    );
  });

  it('a failed request throws without the key or the document in the message', async () => {
    const client = createAnthropicClient({
      apiKey: 'sk-test-key-0123456789abcdef',
      model: 'm',
      fetchImpl: (async () =>
        new Response('{"error":"x"}', { status: 500 })) as unknown as typeof fetch,
    });
    const error = await client
      .complete({ ...buildPrompt(pan), signal: AbortSignal.timeout(1000) })
      .catch((e: Error) => e);
    expect(String((error as Error).message)).toBe('LLM request failed with HTTP 500');
  });
});
