# OnboardIQ: independent QA report

Date: 2026-10-23. Scope: the complete HCLTech specification `case_02_OnboardIQ_V1.0` (functional requirements,
business rules, AI module, responsible-AI guardrails, outputs, non-functional requirements, deliverables). The
evaluator-only section of the specification was not read.

**Rule used for every verdict:** PASS only with an executed test or command whose result is quoted here. Code that
merely exists is not evidence. Test names below are the literal names in the suites; file paths are relative to the
repository root.

## 1. Summary

| Area | Result |
| --- | --- |
| Automated tests | **518 backend + 56 frontend component + 3 Chrome end-to-end: all pass, 0 skipped** |
| Sample decisions (golden) | **60 / 60** applications match all five expected columns |
| Worked examples 1-12 | **12 / 12** pass (examples 1-10 engine + API; 11-12 live workflow) |
| AI-1 classification (sample) | **100.0 % (178/178)**; baselines 98.3 % (declared type) and 84.3 % (keyword rule) |
| AI-2 extraction (sample) | **99.5 % (764/768)** overall; clean PAN / Aadhaar-4 / DOB **100 %** |
| Performance | all three spec targets met by the measured maximum |
| Concurrency | 10 simultaneous actions: **1** success, **9** HTTP 409 |
| Outputs | 32/32 validation checks; two runs from empty databases are **byte-identical** |
| Fixed during this QA | 4 gaps (section 9) |
| Unmet / not verified | section 11 |

## 2. Requirement compliance matrix

Legend: **PASS** (test evidence) · **PARTIAL** (part verified, rest stated) · **NOT TESTED** (no evidence) ·
**FAIL** · **BLOCKED**.

### 2.1 Functional requirements

| ID | Requirement (short) | Verdict | Evidence |
| --- | --- | --- | --- |
| FR-1 | Roles enforced on the server; applicant calling officer API gets 403; changing an ID exposes nothing | PASS | `authorization.test.ts`: "applicant calling an officer-only endpoint gets 403" (7 cases), "swapping the application id in the detail URL never exposes another applicant's data", "…document list URL…", "records the denied attempt in the audit log"; `auth.test.ts`: 401 for 15 unauthenticated routes |
| FR-2 | Form + upload, server validation, last-4 Aadhaar only (12 digits refused), SHA-256, type/encoding/size | PASS | `lifecycle.test.ts` "refuses invalid input with the field names, including a full 12-digit Aadhaar number"; `documents.test.ts` "rejects an oversized file (1 MB + 1 byte) with 422", "rejects invalid UTF-8 with 422 INVALID_ENCODING", "rejects unsupported files (image, pdf)", "rejects a first submission with fewer than 3 files", "stores a valid submission: rows, SHA-256…"; `import.test.ts` "refuses a stored Aadhaar that is not exactly 4 digits" (DB constraint); E2E test 1 (12-digit Aadhaar refused on screen) |
| FR-3 | `POST /documents/{doc_id}/extract`, long format, mock provider, unknown doc → OTHER 0.00, provider by config | PASS | `documents.test.ts` "returns the supplied mock rows…", "unknown document id: OTHER with confidence 0.00", "EXTRACTION_PROVIDER=ai reads the document text; provider, model and prompt are recorded"; screen shows values + confidence (`CaseReview.test.tsx`) |
| FR-4 | R1-R17, decision, codes, score, risk, re-KYC; thresholds from config; 60 samples match | PASS | `golden.test.ts` 60/60; `rules.test.ts` (75 tests) incl. "a lower threshold in the configuration changes the decision without code changes (FR-4)"; `admin-internal.test.ts` "publishes a new version…" |
| FR-5 | Normalisation + Levenshtein; screen shows matched entry, similarity, DOB comparison | PASS | `name-and-dates.test.ts` "example 4: distance 4 over 17 characters = 0.7647"; `worked-examples.test.ts` examples 4, 6 (SAN0002), 7 (PEP0001); `CaseReview.test.tsx` shows watchlist match |
| FR-6 | Review queue HIGH risk first then time; text next to fields; low-confidence highlighted; correction with reason re-runs rules; recommendation with comment | PASS | `frontend-api.test.ts` "list risk and decision per case, with HIGH risk first, then the longest waiting"; `CaseReview.test.tsx` highlight, "requires a reason for every correction", "loads the document text only when asked", "comment of at least 10 characters"; `lifecycle.test.ts` example 9/12 correction with before/after in audit |
| FR-7 | Maker-checker per lifecycle; REVIEW and HIGH-risk APPROVE need checker; maker ≠ checker; mock core banking returns IDs | PASS | `workflow.test.ts` "example 11: the recommending officer cannot approve (403); a different checker can (APPROVED + account)", "maker and checker must be different users (403), even when the same person holds the checker role"; `lifecycle.test.ts` "example 10: a HIGH-risk approval waits for a checker"; `admin-internal.test.ts` core-banking tests; E2E test 2 |
| FR-8 | Applicant timeline, plain reasons, resubmission within 7 days, re-evaluation | PASS | `reason-messages.test.ts` (every code has a message); `frontend-api.test.ts` "gives plain-language reasons and a status timeline, and never codes, scores or watchlist data"; `lifecycle.test.ts` resubmission (example 5) 3 tests incl. expiry to CLOSED_EXPIRED |
| FR-9 | Append-only audit of status, decisions, corrections, watchlist hits, document views | PASS | `import.test.ts` "blocks UPDATE and DELETE on audit_events" (DB trigger); `authorization.test.ts` "the owner can read the text, and the view is audited with user, role, doc id and time"; `workflow.test.ts` "gives a compliance officer the full ordered history"; `lifecycle.test.ts` WATCHLIST_HIT audit |
| FR-10 | Dashboard: by status, STP, review/reject rates, top 5 codes, time in review, pending checker, date filter; reconciles | PASS | `frontend-api.test.ts` "reconciles with the underlying data" (recomputed from tables), "measures time in review and overdue checker items", "filters by application date"; `Compliance.test.tsx` shows exactly the API figures |
| FR-11 | Batch command writes `/output/decisions_output.csv`; sample reproduces expected columns | PASS | `batch.test.ts` "on the sample files with the mock extraction reproduces every expected column (60/60)"; `npm run batch` |

### 2.2 Business rules, lifecycle and additional rules

| Item | Verdict | Evidence |
| --- | --- | --- |
| R1-R17 each (trigger, skip when not usable, threshold from config) | PASS | `rules.test.ts`: 75 tests, at least 2 per rule incl. boundaries (0.80 exactly usable, 90/91 days, 18th birthday, 0.75/0.90 bands) |
| No short-circuit; precedence; codes in rule order | PASS | "evaluates every rule (no short-circuit) and reports codes in rule order", "REJECT beats REVIEW…" |
| Risk, re-KYC, 29 Feb | PASS | "MEDIUM by income, exactly at the threshold", "HIGH by occupation (example 10)", "29 February moves to 28 February…" |
| Routing (APPROVE LOW/MEDIUM → AUTO_APPROVED, HIGH → PENDING_CHECKER, REVIEW → IN_REVIEW, REJECT → AUTO_REJECTED) | PASS | "routes exactly as spec 6.1.2"; `perf` run outcomes |
| Status lifecycle, invalid transitions refused (409) | PASS | `transitions.test.ts`; `workflow.test.ts` "a final status cannot be changed again", "is refused with 409 when the case is not PENDING_CHECKER" |
| Corrected field → confidence 1.00, source OFFICER, rules re-run, still to checker | PASS | `worked-examples.test.ts` "re-running the rules with pan_number ZZTPS9012Y at confidence 1.00 (source OFFICER)…", "a corrected case is APPROVE by the rules but PENDING_CHECKER" |
| Data protection: last-4 Aadhaar, PAN masked in lists/exports, documents only to officers and owner, views audited | PASS | `masking.test.ts`; `authorization.test.ts` "the review queue lists masked PANs only", "document access" (8 tests); `frontend-api.test.ts` audit CSV |
| Roles: applicant registers; officer cannot give final approval; compliance officer maintains watchlists and configuration | PASS | `auth.test.ts` registration (4 tests); `authorization.test.ts` "a KYC officer cannot make a checker decision"; `admin-internal.test.ts` watchlists + config; `RegisterPage.test.tsx`, `Maintenance.test.tsx`; E2E test 3 |

### 2.3 AI module and responsible AI

| ID | Verdict | Evidence |
| --- | --- | --- |
| AI-1 classification, two baselines, injection → OTHER (target ≥ 97 %) | PASS | `ai-extraction.test.ts` "v2 meets the AI-1 reference target"; evaluation report section 1: 100.0 % vs 98.3 % / 84.3 %; injection D3000486 → OTHER |
| AI-2 field extraction (≥ 90 % overall, ≥ 98 % PAN/Aadhaar-4/DOB clean), regex-only comparison | PASS | "meets the AI-2 reference targets…"; 99.5 % overall vs 83.2 % regex-only |
| AI-3 "ai" provider behind FR-3; uploads classified and decided; 10 s timeout → confidence 0 → REVIEW; output files | PASS | `documents.test.ts` "a provider that throws, or hangs past the timeout, degrades the same way"; `extraction_output.csv`, `ai_decisions_output.csv` validated |
| AI-4 calibration and labelled feedback (SHOULD) | PARTIAL | Precision of fields accepted at ≥ 0.80: **100.0 % (742/742)**; sent to review 25 (88 % of those were in fact correct). Officer corrections are stored as labelled rows (`field_corrections`, source OFFICER) — tested in `lifecycle.test.ts`. The **officer correction rate is not measured**: the supplied data has no officer feedback on AI-extracted fields |
| AI-5 reviewer summary (MAY) | PASS (guardrails) | Implemented in this QA round (section 9). Live Groq spot check passed (section 11). Guardrails PASS with a fake model: `review-summary.test.ts` (7), `ai-summary-openapi.test.ts` (5): ≤ 80 words, no decision wording, every quoted value must be in the case, applicants 403, labelled "AI-generated", 503 when off. |
| Human oversight, explainability, uncertain output, fallback | PASS | maker-checker tests above; trace with compared values (`rules.test.ts` "the trace records the values compared for every rule"); R3 skip tests; fallback tests |
| Privacy (no full Aadhaar, LLM off by default, no PII in logs) | PASS | `redact.test.ts`; `auth.test.ts` "never writes passwords or tokens to the request log"; `authorization.test.ts` "never writes document text to the request log" |
| Prompt injection | PASS | `documents.test.ts` "the supplied injection document (D3000486) is OTHER, changes no decision", "uploading the injection text as a new document… approves nothing"; `ai-extraction.test.ts` "instructions hidden inside an otherwise normal document are never followed"; `llm.test.ts` delimiters + strict schema |
| Fairness: NAME_MISMATCH_MINOR by gender | PASS | evaluation report section 7: F 1/50 (2.0 %), M 1/50 (2.0 %) with both extractions; counts too small for a statistical test (stated) |
| Governance: extractor version stored with every extraction | PASS | "is persisted once per provider version, with provider and version recorded" |

### 2.4 Outputs

| Output | Verdict | Evidence |
| --- | --- | --- |
| Decision API response (6.3) | PASS | "the decision response has the structure of spec section 6.3" |
| `/output/decisions_output.csv` | PASS | 100 rows; header/order/format checks 5/5 in `validation_report.json` |
| Dashboard | PASS | FR-10 |
| Audit export CSV incl. document views and corrections | PASS | `frontend-api.test.ts` "returns the history with actor names, and exports it as CSV" |
| `/output/extraction_output.csv` | PASS | 296 doc_type rows, 1,583 rows; 6 checks |
| `/output/ai_decisions_output.csv` | PASS | 100 rows; 5 checks |
| `/output/evaluation_report.md`, `model_card.md` | PASS | section checks; no timestamps; model card includes AI-5 section |

### 2.5 Non-functional requirements

| NFR | Verdict | Evidence (`output/performance_report.md`) |
| --- | --- | --- |
| One application evaluated within 2 s (mock) | PASS | API submit, 158 runs: p50 17.0 ms, p95 18.6 ms, **max 24.4 ms** |
| AI extraction ≤ 1 s/doc without LLM (≤ 10 s with) | PASS (no LLM) | 474 documents: p50 10.6 ms, **max 18.5 ms**. With-LLM latency NOT TESTED (timeout enforced and tested) |
| 100-application batch within 60 s | PASS | real command incl. process start, 3 runs: **max 174.6 ms** |
| Concurrency: second action gets 409 | PASS | perf: 10 parallel submits → 1×200, 9×409; tests: submissions, recommendation vs correction, two checkers |
| Precision (float, 4 decimals for output only; IST calendar dates) | PASS | "is rounded to 4 decimals for output only", "treats an exact-on-paper 0.90 as 0.90" |
| Configurability; watchlist update re-screens open cases on request | PASS | config test above; `lifecycle.test.ts` "adds a sanctions entry … then re-screens on request"; E2E test 3 |
| File handling (type, UTF-8, size, hash, never executed, authorised URLs) | PASS | `documents.test.ts` upload + retrieval tests; files stored 0600 outside web root |
| Idempotency (same hash → no duplicate) | PASS | "does not store a duplicate: the same file again returns the original document", import "rejects the same file content twice for one application" |
| Masking (Aadhaar-4; PAN in lists, logs, exports) | PASS | `masking.test.ts`, queue and audit CSV tests |

### 2.6 Deliverables

| Deliverable | Verdict | Evidence |
| --- | --- | --- |
| `/output/design/design_document.md` (R1-R17 flowchart, routing, extraction interface, technology decisions, assumptions) | PASS | added in this QA round; `npm run design` |
| API documentation (OpenAPI/Swagger) | PASS | `output/design/openapi.json`, `/api/docs`; `ai-summary-openapi.test.ts`: every documented route exists and no route is undocumented |
| Status-lifecycle diagram, ER diagram | PASS | generated from `transitions.ts` and `schema.prisma` |
| Rule config and watchlists loaded from the supplied files | PASS | `import.test.ts` "stores the rule configuration and watchlists from the files, not from code" |
| AI track files, code, prompts/patterns, model card | PASS | `/output`, `backend/src/modules/extraction/ai`, `/prompt` |
| Dockerfile + docker-compose | PASS | `docker compose up -d --build backend frontend`: all three containers healthy; through the web container on :8080 the UI, deep links, `/api/v1/health`, `/health/db`, OpenAPI, login, dashboard and checker queue answer 200; applicant gets 403 on admin API and 404 on another applicant's case |
| `/code` folder | PARTIAL | Source is in `backend/` and `frontend/` at the repository root, not under `/code` (team decision; mapped in the README) |
| `/prompt` (optional) | PASS | LLM extraction and AI-5 prompts, generated from the code. Prompts used with AI coding assistants are not included |

## 3. Automated test results

| Suite | Command | Result |
| --- | --- | --- |
| Backend unit + integration (real PostgreSQL test database) | `npm --prefix backend test` | 34 files, **518 passed**, 0 failed, 0 skipped |
| Frontend components (jsdom) | `npm --prefix frontend test` | 12 files, **56 passed** |
| End-to-end (installed Chrome, throw-away database) | `npm run e2e` | **3 passed**: new application with upload; applicant → officer correction → different checker → approved; registration + watchlist change + re-screen |
| Static checks + builds | `npm run check` | typecheck, ESLint, Prettier, both builds: pass |
| Output validation | `npm run outputs -- --fresh-db` | 32/32 checks |
| Determinism | `npm run outputs:repeat` | 8 files byte-identical across two empty databases |
| Docker | `docker compose build` | both images built |

## 4. Sample-decision comparison

All 60 sample applications match `expected_decision`, `expected_reason_codes`, `expected_name_match_score`,
`expected_risk_category` and `expected_rekyc_due_date` exactly (`golden.test.ts`, `output/sample/decisions_sample_output.csv`).
Worked examples (expected / actual, columns: decision / codes / score / risk / re-KYC; ∅ = empty):

| # | Application | Expected | Actual | Status (workflow test) |
| --- | --- | --- | --- | --- |
| 1 | A2000001 | APPROVE / ∅ / 1.0000 / LOW / 2036-03-04 | identical | AUTO_APPROVED + account ✓ |
| 2 | A2000002 | REJECT / AGE_BELOW_18 / 1.0000 / ∅ / ∅ | identical | AUTO_REJECTED ✓ |
| 3 | A2000003 | REJECT / PAN_MISMATCH / 1.0000 / ∅ / ∅ | identical | AUTO_REJECTED ✓ |
| 4 | A2000004 | REVIEW / NAME_MISMATCH_MINOR / 0.7647 / LOW / 2036-03-04 | identical | IN_REVIEW ✓ |
| 5 | A2000005 | REVIEW / ADDRESS_PROOF_STALE / 1.0000 / LOW / 2036-03-04 | identical | IN_REVIEW ✓ |
| 6 | A2000006 | REJECT / SANCTIONS_MATCH / 1.0000 / ∅ / ∅ (SAN0002) | identical | AUTO_REJECTED ✓ |
| 7 | A2000007 | REVIEW / PEP_MATCH / 1.0000 / HIGH / 2028-03-04 (PEP0001) | identical | IN_REVIEW ✓ |
| 8 | A2000008 | REVIEW / DOCUMENT_MISSING\|DOCUMENT_TYPE_MISMATCH / 1.0000 / LOW / 2036-03-04 | identical | IN_REVIEW ✓ |
| 9 | A2000009 | REVIEW / LOW_EXTRACTION_CONFIDENCE / 1.0000 / LOW / 2036-03-04; PAN_MISMATCH not evaluated | identical; R6 SKIPPED | IN_REVIEW ✓ |
| 10 | A2000010 | APPROVE / ∅ / 1.0000 / HIGH / 2028-03-04 | identical | PENDING_CHECKER ✓ |
| 11 | live | maker approves own case → 403; other checker → APPROVED + account | as expected | `workflow.test.ts` ✓ |
| 12 | live | correct PAN to ZZTPS9012Y → APPROVE, no codes, PENDING_CHECKER, audit old/new | as expected | `lifecycle.test.ts`, E2E ✓ |

With the team's own AI extraction instead of the mock file, 58/60 sample applications match the expected columns.
The two differences (A2000021, A2000050) are cases where the AI reads a poor scan correctly while the expected
columns were produced from the mock misreads. Example 9 with AI extraction gives APPROVE, as the spec describes.

## 5. Data tests (import)

All in `backend/test/integration/import.test.ts`, run on a clean test database:

| Scenario | Result |
| --- | --- |
| Clean import, expected row counts, sample/eval kept apart, values preserved, inputs never modified | PASS (6 tests) |
| Duplicate import (same files again) | PASS: "skips everything and changes nothing"; partial earlier import fills only the gap |
| Malformed files (bad rows with line numbers, invalid JSONL, confidence outside 0-1) | PASS: nothing written |
| Missing column / missing file / incomplete rule config | PASS: explicit errors |
| Invalid references (unknown occupation, application, document; dataset before reference data) | PASS: rejected |
| Duplicate document hashes for one application | PASS: rejected |
| Rollback | PASS: "rolls everything back when the import fails after writing" |

## 6. Security findings

| Test | Result | Evidence |
| --- | --- | --- |
| Unauthenticated access | PASS | 401 on 15 protected routes; core banking 401 without the service key |
| Role escalation | PASS | registration rejects a `role` field (strict body); officer → checker routes 403; checker → maker 403; applicant → staff screens show nothing and the API returns 403 |
| Applicant-to-applicant isolation (IDOR) | PASS | 404 identical to "does not exist"; lists filtered; attempt audited |
| Unauthorised document access | PASS | other applicant 404, officer outside scope 404, list without text, every view audited |
| Maker-checker separation | PASS | 403 even when the same person holds the checker role |
| Workflow bypass by direct API | PASS | wrong-state actions 409; HIGH-risk approval cannot complete without a checker; final statuses frozen |
| Sensitive-data masking | PASS | Aadhaar last 4 only (DB constraint); masked PAN in lists, exports and logs; no passwords or tokens in logs |
| Prompt injection | PASS | injection document → OTHER, no decision change, no LLM instruction followed |
| File upload validation | PASS | size, encoding, type, count, declared type, duplicates |
| Brute force | PASS | lock-out with 429 after five failures, generic message, no user enumeration |

Findings (no open high-severity issue):

1. *Low.* Document IDs are sequential (the supplied `D3xxxxxx` format), so they are guessable; access is protected
   by authorisation (tested), which is what the spec requires ("require authorisation").
2. *Low.* Session tokens are kept in `sessionStorage`; any script injection would expose them. The UI never renders
   untrusted HTML (document text is shown as plain text, tested). A production build would add a strict CSP for
   the web app.
3. *Info.* Swagger UI loads its assets from a pinned CDN version with a CSP limited to that page.

## 7. AI evaluation (from `output/evaluation_report.md`, measured, development set)

| Metric | Regex-only first version | AI provider (rules 2.0.0, no LLM) |
| --- | --- | --- |
| Classification accuracy | 84.3 % (150/178) | **100.0 % (178/178)** |
| Baseline: declared type as prediction | 98.3 % (175/178) | |
| Baseline: keyword rule | 84.3 % (150/178) | |
| Field exact match, all | 83.2 % (639/768) | **99.5 % (764/768)** |
| Clean scans / poor scans | 85.4 % / 56.9 % | 100.0 % / 93.1 % (54/58) |
| PAN, Aadhaar-4, DOB on clean documents | 100 % / 100 % / 100 % | 100 % / 100 % / 100 % |
| Precision of fields accepted at ≥ 0.80 | 98.5 % (639/649) | **100.0 % (742/742)**, coverage 96.6 % |

Confusion matrix (AI provider, sample): diagonal only. PAN 60, Aadhaar 57, electricity bill 22, bank statement 27,
driving licence 10, OTHER 2. Per-field accuracy: name 97.7 %, all other fields 100 %.

Evaluation set (100 applications, no labels, so **no accuracy is claimed**): document type agrees with the mock
on 296/296, confident field values on 98.3 %, decisions on 98/100. Injection document D3000486 → OTHER (the plain
keyword rule says AADHAAR_CARD). Caveat: the extractor was developed on the sample documents, so the sample figures
are development-set results. No figure involves an LLM.

## 8. Performance results

See `output/performance_report.md` (environment: Apple M5, 10 cores, 16 GB, Node 26.5, PostgreSQL 16.14 in Docker,
localhost). Methodology: throw-away database loaded from the supplied files; each application submitted
sequentially through the HTTP API (mock extraction + rules + persistence + audit); AI provider timed on every
supplied document; the batch command run three times as a separate process; concurrency as 10 parallel
requests. Single-machine figures; they are not a capacity test.

## 9. Fixes made during this QA (highest priority first)

| # | Gap found | Fix | Re-run |
| --- | --- | --- | --- |
| 1 | No API documentation, design document, lifecycle or ER diagram in `/output/design` (mandatory deliverable) | OpenAPI 3.1 generated from the route validation schemas, served at `/api/docs`; design document; diagrams generated from the code (`npm run design`) | contract test: every documented route exists, none undocumented |
| 2 | Applicant registration existed only in the API; Compliance Officer could not maintain watchlists or configuration from the screen | Registration page; Maintenance page (rule configuration versions, sanctions/PEP add/remove, re-screen, close overdue, re-KYC due) | 8 component tests + E2E test 3 |
| 3 | No measured performance evidence at API level | `npm run perf` and `output/performance_report.md` | all targets met |
| 4 | AI-5 reviewer summary (MAY) missing; LLM requested by the product owner | Guarded LLM summary, off by default, documented in the model card and `/prompt` | 12 backend + 3 component tests |

| 5 | Imported applications stayed SUBMITTED until an applicant pressed Submit, so the dashboard showed 160 received and rates over one case | `npm run db:process`, processing inside `db:seed`, **Maintenance → Process received applications**, and a dashboard notice while received cases wait | `process-received.test.ts` (3): 158/158 routed, sample decisions equal the expected columns, repeat is a no-op, screen-started cases untouched |
| 6 | Only Anthropic available as LLM provider | Groq client (OpenAI-compatible, forced tool call) for extraction and AI-5, chosen per feature in `.env` | `llm-clients.test.ts` (5) |

Earlier in this session: three admin routes (`rescreen`, `expire-overdue`, `rekyc-due`) had been lost in an edit
and were caught by the regression suite and restored before this QA.

## 10. Commands

```bash
# one-time
cp .env.example .env            # fill the change-me values
npm run install:all
npm run db:up && npm run db:migrate && npm run db:seed

# run
npm run dev                     # API http://localhost:3000 (docs /api/docs), UI http://localhost:5173
docker compose up --build       # alternative: everything in Docker, UI on http://localhost:8080

# verify
npm run check                   # typecheck, lint, format, 518 + 56 tests, builds
npm run e2e                     # Chrome end-to-end (own database)
npm run outputs -- --fresh-db   # regenerate and validate /output
npm run outputs:repeat          # determinism proof
npm run perf                    # performance_report.md
npm run design                  # output/design and /prompt
npm run batch                   # decisions_output.csv without a database
```

## 11. Known limitations and unmet requirements

Unmet or unverified (nothing else is open):

1. **Live LLM: spot-checked once, not evaluated.** With Groq `openai/gpt-oss-120b`: the AI-5 summary of worked
   example 9 passed every guardrail (45 words, values from the case, no decision wording, 1.9 s), and LLM-assisted
   extraction of the poor PAN scan D3000025 read `ZZTPS9012Y` at confidence 0.95 in 0.9 s (target 10 s). One
   sample each: no accuracy is claimed for the LLM path, and the evaluation report figures remain LLM-free.
2. **LLM extraction is off by default** (`EXTRACTION_LLM` unset, `EXTRACTION_PROVIDER=mock` for the graded outputs).
3. **AI-4 officer correction rate: not measurable** with the supplied data (no officer feedback on AI-extracted
   fields); storage of corrections as labelled feedback is tested.
4. **`/code` packaging (decided: keep):** the source lives in `backend/` and `frontend/` at the repository root
   instead of `/code`; the README section "Where the spec deliverables are" maps each deliverable to its location.
5. Resolved: the full Docker stack was started and smoke-tested (section 2.6).

Known limitations (by design or out of scope): text-only documents (no image OCR); synthetic data and fictional
lists; mock core banking; no real UIDAI/NSDL/CKYC checks; single-machine performance figures; development-set AI
accuracy; the viva guide mentions JWT and bcrypt, while the implementation uses revocable server-side sessions and
scrypt (design choice, documented in the design document).
