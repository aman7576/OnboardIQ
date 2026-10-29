// The "ai" extraction provider (spec AI-3), behind the same interface as the mock provider:
//   deterministic rules (always) + an optional LLM that only proposes, merged under strict validation.
// It supplies document type and fields with confidence and nothing else: it cannot approve anything.
import type { ExtractionOutput, ExtractionProvider } from '../provider.js';
import {
  mergeProposal,
  buildPrompt,
  parseLlmResponse,
  PROMPT_VERSION,
  type LlmClient,
} from './llm.js';
import { extractWithRules, type RulesResult } from './rules-extractor.js';

export const RULES_VERSION = '2.0.0';
export const LLM_TIMEOUT_MS = 10_000;

export interface AiProviderOptions {
  llm?: LlmClient;
  llmTimeoutMs?: number;
}

/** provider | rules version | model | prompt version, stored with every extraction for reproducibility. */
export const aiExtractorVersion = (llm?: LlmClient): string =>
  `ai|rules=${RULES_VERSION}|model=${llm ? `${llm.name}:${llm.model}` : 'none'}|prompt=${llm ? PROMPT_VERSION : 'none'}`;

const toOutput = (r: RulesResult, extractorVersion: string): ExtractionOutput => ({
  docType: r.docType,
  docTypeConfidence: r.docTypeConfidence,
  fields: r.fields,
  extractorVersion,
  warnings: r.warnings,
});

export function createAiProvider({
  llm,
  llmTimeoutMs = LLM_TIMEOUT_MS,
}: AiProviderOptions = {}): ExtractionProvider {
  const version = aiExtractorVersion(llm);
  return {
    name: 'AI',
    async extract({ text }) {
      const rules = extractWithRules(text, RULES_VERSION);
      // No model configured, or the text carries instructions: the deterministic result stands.
      // (Instruction-laden text is not even sent to a model.)
      if (!llm || rules.warnings.includes('prompt_injection_suspected'))
        return toOutput(rules, version);

      // A model failure, timeout or invalid answer throws: the caller's fallback turns that into
      // doc_type OTHER with confidence 0, which sends the case to REVIEW (spec AI-3).
      const prompt = buildPrompt(text);
      const raw = await llm.complete({ ...prompt, signal: AbortSignal.timeout(llmTimeoutMs) });
      return toOutput(mergeProposal(rules, parseLlmResponse(raw)), version);
    },
  };
}
