import { describe, expect, it } from 'vitest';
import { createGroqClient, createLlmClient } from '../../src/modules/extraction/ai/llm-clients.js';
import { EXTRACTION_TOOL } from '../../src/modules/extraction/ai/llm.js';
import { SUMMARY_TOOL } from '../../src/modules/ai-summary/summary.js';
import { parseEnv } from '../../src/config/env.js';

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('Groq client', () => {
  it('forces the given tool, sends system and user separately with the key as a bearer token, and returns the tool arguments', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const client = createGroqClient({
      apiKey: 'gsk_test_key_0123456789abcdef',
      model: 'openai/gpt-oss-120b',
      fetchImpl: ((url: string, init: RequestInit) => {
        sent = { url, init };
        return ok({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: 'record_summary', arguments: '{"summary":"R3 fired."}' } },
                ],
              },
            },
          ],
        });
      }) as typeof fetch,
    });
    const answer = await client.complete({
      system: 'S',
      user: 'U',
      signal: AbortSignal.timeout(1000),
      tool: SUMMARY_TOOL,
    });
    expect(answer).toBe('{"summary":"R3 fired."}');
    expect(sent?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((sent?.init.headers as Record<string, string>).authorization).toBe(
      'Bearer gsk_test_key_0123456789abcdef',
    );
    const body = JSON.parse(sent?.init.body as string);
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-120b',
      temperature: 0,
      tool_choice: { type: 'function', function: { name: 'record_summary' } },
    });
    expect(body.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ]);
    expect(body.tools[0].function.parameters).toEqual(SUMMARY_TOOL.schema);
  });

  it('uses the extraction tool when none is named', async () => {
    let tool = '';
    const client = createGroqClient({
      apiKey: 'k'.repeat(24),
      model: 'm',
      fetchImpl: ((_u: string, init: RequestInit) => {
        tool = JSON.parse(init.body as string).tool_choice.function.name;
        return ok({ choices: [{ message: { content: '{}' } }] });
      }) as typeof fetch,
    });
    await client.complete({ system: 'S', user: 'U', signal: AbortSignal.timeout(1000) });
    expect(tool).toBe(EXTRACTION_TOOL.name);
  });

  it('fails without echoing the key or the prompt', async () => {
    const client = createGroqClient({
      apiKey: 'gsk_secret_0123456789abcdef',
      model: 'm',
      fetchImpl: (() => Promise.resolve(new Response('denied', { status: 401 }))) as typeof fetch,
    });
    const err = await client
      .complete({ system: 'secret system', user: 'secret user', signal: AbortSignal.timeout(1000) })
      .catch((e: Error) => e);
    expect(String(err)).toBe('Error: LLM request failed with HTTP 401');
  });
});

describe('LLM configuration', () => {
  const base = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SESSION_SECRET: 's'.repeat(40),
    CORE_BANKING_SERVICE_KEY: 'k'.repeat(24),
  };
  it('needs GROQ_API_KEY when a feature uses groq', () => {
    expect(() => parseEnv({ ...base, REVIEW_SUMMARY_LLM: 'groq' })).toThrow(/GROQ_API_KEY/);
    expect(
      parseEnv({ ...base, REVIEW_SUMMARY_LLM: 'groq', GROQ_API_KEY: 'g'.repeat(24) }).GROQ_MODEL,
    ).toBe('openai/gpt-oss-120b');
  });
  it('builds the right client, or none when off or the key is missing', () => {
    const env = {
      ANTHROPIC_API_KEY: undefined,
      EXTRACTION_LLM_MODEL: 'claude-haiku-5-5',
      GROQ_API_KEY: 'g'.repeat(24),
      GROQ_MODEL: 'openai/gpt-oss-120b',
    };
    expect(createLlmClient('groq', env)?.name).toBe('groq');
    expect(createLlmClient('none', env)).toBeUndefined();
    expect(createLlmClient('anthropic', env)).toBeUndefined();
  });
});
