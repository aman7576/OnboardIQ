# Model card - OnboardIQ document extraction ("ai" provider)

## Purpose

Reads the OCR text of one KYC document and proposes (a) a document type and (b) the fields that belong to it, each with a confidence between 0 and 1. It is an input to the rules engine and never decides: it cannot approve, reject or recommend anything. Humans (officer, then a different checker) approve every reviewed or high-risk case.

## Versions recorded with every extraction

- Provider: AI. Extractor version string: `ai|rules=2.0.0|model=none|prompt=none` = provider | rules version | model | prompt version.
- Rules version 2.0.0 (deterministic parsing, OCR repair, validators, confidence). Model: none by default. Prompt version (only when an LLM is enabled): `extract-v1`.
- Rules engine used for decisions: 1.0.0.

## How it works

1. **Injection guard.** Lines that address a reader with instructions (for example "ignore all previous instructions", "approve this applicant") are removed; a document containing any is flagged and classified OTHER with no fields. Such text is not sent to a model.
2. **Classification** from the text only (`declared_doc_type` is never an input): weighted features per type that tolerate OCR damage; too little evidence gives OTHER.
3. **Field extraction** per type with regular expressions and layout rules, OCR repair where the field structure says which characters belong (PAN `AAAAA9999A`, dates, pincode, Aadhaar last 4), and vocabulary repair for addresses. Output is normalised: dates `YYYY-MM-DD`, PAN upper case, Aadhaar last four digits only.
4. **Deterministic validators** reject malformed values (invalid PAN, impossible date, wrong pincode); an invalid value is dropped, not passed on.
5. **Confidence**: 0.97 for a structured field that validated untouched, 0.95 for free text on a clean scan, 0.90 / 0.72 on a garbled scan, 0.70 when any repair was needed. Below 0.80 the rules send the case to review.
6. **Optional LLM (off by default).** Receives only the document text, between random delimiter lines, with an instruction to treat it as untrusted data. It must return structured JSON that matches a strict schema (any extra key, such as a decision, invalidates the answer). Its values are re-validated and merged: agreement raises confidence, disagreement lowers it below 0.80, and it can never change a document type.
7. **Timeout and fallback.** 10 seconds per document. On any failure (error, timeout, malformed answer) the document is OTHER with confidence 0, which routes the case to REVIEW.

## Measured performance (development set only)

On the 178 sample documents: classification 100.0% (178/178); field exact-match 99.5% (764/768) overall, 100.0% (710/710) on clean scans, 93.1% (54/58) on poor scans; precision of fields accepted at confidence >= 0.80 100.0% (742/742) with 96.6% (742/768) coverage.
These figures come from documents the extractor was developed on. Full tables, the confusion matrix and the comparison with the regex-only first version are in `evaluation_report.md`. No figure involves an LLM.

## Data

- Development data: the supplied sample texts and truth file (synthetic). The truth is used only to score.
- Address vocabulary: public place names plus words seen in the clean sample documents.
- Evaluation data: no labels; used for agreement checks and to produce outputs only.

## Responsible AI

- **Human oversight:** extraction feeds rules; every REVIEW and HIGH-risk case needs a maker and a different checker; officers can override any field with a reason (stored as labelled feedback).
- **Uncertainty:** fields below 0.80 are not used by identity rules and send the case to review, so a misread cannot cause an automatic rejection.
- **Prompt injection:** document text is data. It is screened, delimited, and never obeyed; the injection document in the evaluation set is classified OTHER and cannot change a decision.
- **Privacy:** synthetic data only. No LLM is called unless explicitly enabled (Groq or Anthropic); when enabled only the document text is sent, prompts are not logged, and the provider and model are recorded in the extractor version. Aadhaar: only the last four digits are ever produced.
- **Fairness:** one name normalisation for everyone; the share of NAME_MISMATCH_MINOR by gender is reported in the evaluation report.
- **Governance:** the extractor version is stored with every extraction so results can be reproduced.

## AI-5 reviewer summary (optional, off by default)

- Enabled with `REVIEW_SUMMARY_LLM=groq` (`GROQ_API_KEY`, `GROQ_MODEL`) or `anthropic` (`ANTHROPIC_API_KEY`, `EXTRACTION_LLM_MODEL`); prompt version `review-summary-v1`. The provider and model are returned with every summary.
- Input: a fact list built by code from the rule trace and the extracted values of a REVIEW case (no document text, no decision, no rule outcomes), between random delimiter lines, declared untrusted.
- Output: one string through a strict tool schema. Withheld (HTTP 502, nothing shown) when it exceeds 80 words, contains decision or advice wording, or quotes a number or identifier that is not in the case data. Shown labelled "AI-generated" with the model and prompt version; generated only when an officer asks.
- Not evaluated with a live model in this submission: the guardrails are tested with a fake model.

## Limitations and risks

- Unknown accuracy outside the development layouts; real scans and other issuers are not covered.
- Names on poor scans can be wrong and are held below 0.80; a wrong value that scores above 0.80 would be accepted (none occurred on the sample).
- The LLM path is not measured here.

## Out of scope

Real OCR of images, face matching, real identity or sanctions systems.
