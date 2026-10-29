// Prompt-injection guard. Document text is data. Lines that address a reader (a person or an AI) with
// instructions are not document content: they are removed before anything is classified or extracted,
// and the document is flagged. Nothing in this module ever acts on what such a line asks for.
const PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+(?:all\s+|any\s+)?(?:the\s+)?(?:previous|prior|above|earlier|your)/i,
  /(?:system|developer)\s+(?:prompt|message|instructions?)/i,
  /(?:automated\s+systems?|ai\s+assistants?|language\s+model|\bllm\b|\bchatgpt\b|\bclaude\b)/i,
  /(?:approve|accept|pass|verify)\s+(?:this|the)\s+(?:applicant|application|customer|document)/i,
  /mark\s+(?:every|all|each)\s+(?:check|rule|field)/i,
  /you\s+(?:are|must|should|will)\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|model|approve|ignore|output|respond)/i,
  /(?:respond|reply|answer|output)\s+(?:only\s+)?with\b/i,
  /\bdo\s+not\s+(?:follow|extract|flag|report)\b/i,
];

export interface Screened {
  text: string; // the document with instruction-like lines removed
  suspicious: boolean;
  removed: string[]; // the removed lines, for the audit/notes (never executed)
}

export function screenInjection(text: string): Screened {
  const kept: string[] = [];
  const removed: string[] = [];
  for (const line of text.split(/\r?\n/))
    (PATTERNS.some((p) => p.test(line)) ? removed : kept).push(line);
  return { text: kept.join('\n'), suspicious: removed.length > 0, removed };
}
