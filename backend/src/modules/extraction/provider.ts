// Extraction service interface (spec FR-3). A provider turns document TEXT into a document type and
// fields with confidence. It never decides anything, and it never receives declared_doc_type:
// classification must come from the text alone.
export interface ExtractionInput {
  docId: string;
  text: string; // untrusted data, never instructions
}

export interface ExtractedFieldOutput {
  name: string;
  value: string;
  confidence: number; // 0 to 1
}

export interface ExtractionOutput {
  docType: string;
  docTypeConfidence: number;
  fields: ExtractedFieldOutput[];
  extractorVersion: string; // rules / model / prompt version, stored with every extraction
  /** Notes such as 'prompt_injection_suspected' or 'missing_dob'; informational, never a decision. */
  warnings?: string[];
}

export interface ExtractionProvider {
  readonly name: 'MOCK' | 'AI';
  extract(input: ExtractionInput): Promise<ExtractionOutput>;
}

/** What callers get from a provider wrapped with timeout and fallback: it never throws. */
export type SafeExtractionOutput = ExtractionOutput & { degraded: boolean };

export interface SafeExtractionProvider {
  readonly name: ExtractionProvider['name'];
  extract(input: ExtractionInput): Promise<SafeExtractionOutput>;
}
