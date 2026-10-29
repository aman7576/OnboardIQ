// Plain chat with Groq (OpenAI-compatible). Unlike the extraction client there is no forced tool call: the
// reply is free text for the applicant. The key is never logged or echoed in errors.
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatClient {
  readonly model: string;
  reply(system: string, turns: ChatTurn[], signal: AbortSignal): Promise<string>;
}

interface GroqChatOptions {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export function createGroqChatClient({
  apiKey,
  model,
  fetchImpl = fetch,
  baseUrl = 'https://api.groq.com/openai/v1',
}: GroqChatOptions): ChatClient {
  return {
    model,
    async reply(system, turns, signal) {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          max_tokens: 1500,
          // gpt-oss models think before answering; keep it short so the answer fits in the token budget.
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          messages: [{ role: 'system', content: system }, ...turns],
        }),
      });
      if (!res.ok) throw new Error(`Chat request failed with HTTP ${res.status}`);
      const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      const text = body.choices?.[0]?.message?.content
        ?.replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      if (!text) throw new Error('The chat model returned no answer');
      return text;
    },
  };
}
