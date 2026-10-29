// LLM providers behind one interface (LlmClient). The model only answers through a tool whose JSON schema the caller
// gives; the caller validates the answer again. Neither the prompt nor the key is ever logged or echoed in errors.
import type { Env } from '../../../config/env.js';
import { createAnthropicClient, EXTRACTION_TOOL, LlmResponseError, type LlmClient } from './llm.js';

interface GroqOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Groq: OpenAI-compatible chat completions with forced tool calling. */
export function createGroqClient({
  apiKey,
  model,
  fetchImpl = fetch,
  baseUrl = 'https://api.groq.com/openai/v1',
}: GroqOptions): LlmClient {
  return {
    name: 'groq',
    model,
    async complete({ system, user, signal, tool }) {
      const answerTool = tool ?? EXTRACTION_TOOL;
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: answerTool.name,
                description: answerTool.description,
                parameters: answerTool.schema,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: answerTool.name } },
        }),
      });
      if (!res.ok) throw new Error(`LLM request failed with HTTP ${res.status}`);
      const body = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      const message = body.choices?.[0]?.message;
      const call = message?.tool_calls?.find((c) => c.function?.name === answerTool.name);
      if (call?.function?.arguments) return call.function.arguments;
      if (message?.content) return message.content;
      throw new LlmResponseError('the model returned no structured answer');
    },
  };
}

/** Builds the configured client for a feature, or undefined when it is off. */
export function createLlmClient(
  kind: 'none' | 'anthropic' | 'groq',
  env: Pick<Env, 'ANTHROPIC_API_KEY' | 'EXTRACTION_LLM_MODEL' | 'GROQ_API_KEY' | 'GROQ_MODEL'>,
): LlmClient | undefined {
  if (kind === 'anthropic' && env.ANTHROPIC_API_KEY)
    return createAnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.EXTRACTION_LLM_MODEL,
    });
  if (kind === 'groq' && env.GROQ_API_KEY)
    return createGroqClient({ apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL });
  return undefined;
}
