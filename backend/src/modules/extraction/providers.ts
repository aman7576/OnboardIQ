import type { ExtractionProvider, SafeExtractionProvider } from './provider.js';
import { createAiProvider } from './ai/ai-provider.js';
import type { LlmClient } from './ai/llm.js';
import { createMockProvider } from './mock-provider.js';

export const EXTRACTION_TIMEOUT_MS = 10_000; // spec AI-3: 10 seconds per document

/** Provider selection by configuration (EXTRACTION_PROVIDER), no code change needed. */
export function createProvider(
  kind: 'mock' | 'ai',
  dataDir: string,
  llm?: LlmClient,
): ExtractionProvider {
  return kind === 'mock' ? createMockProvider(dataDir) : createAiProvider(llm ? { llm } : {});
}

/**
 * Timeout and fallback (spec AI-3 and "Fallback"): if the provider fails or is too slow, the
 * document gets doc_type OTHER with confidence 0, which sends the case to REVIEW. Never throws.
 */
export function withFallback(
  provider: ExtractionProvider,
  timeoutMs = EXTRACTION_TIMEOUT_MS,
  log: (message: string) => void = () => undefined,
): SafeExtractionProvider {
  return {
    name: provider.name,
    async extract(input) {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`extraction timed out after ${timeoutMs} ms`)),
            timeoutMs,
          );
        });
        return { ...(await Promise.race([provider.extract(input), timeout])), degraded: false };
      } catch (err) {
        log(
          `extraction failed for ${input.docId}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
        return {
          docType: 'OTHER',
          docTypeConfidence: 0,
          fields: [],
          extractorVersion: `${provider.name.toLowerCase()}:unavailable`,
          degraded: true,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
