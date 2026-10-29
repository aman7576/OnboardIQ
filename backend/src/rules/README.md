# Rules engine (R1-R17)

`evaluate(application, documents, config, watchlists, existingCustomers) -> Evaluation` in `evaluate.ts` is a
**pure function**: no database, HTTP or AI. The REST API, the batch command and the tests all call it.
Thresholds, patterns, title tokens, re-KYC periods and lists come from `case_02_rules_config_V1.0.json`, the
occupations file and the watchlist files (loaded by `file-data.ts` or from the database tables); none are
constants in the rules. `config` also carries the occupation → risk table.

- Decision (`APPROVE` / `REVIEW` / `REJECT`) is separate from workflow status. `routing.ts` maps a decision to the
  first status (spec 6.1.2); the status machine itself is `modules/workflow`.
- Every rule runs (no short-circuit). A rule whose field is not usable is reported as `SKIPPED` in the trace.
- Final decision: REJECT if any of R4-R10 triggered; else REVIEW if any of R1-R3 or R11-R17 did; else APPROVE.
  Reason codes are listed in rule order. Risk and re-KYC date exist for APPROVE and REVIEW only; the name score is
  reported (4 decimals, output only) whenever it can be computed.

A field is **usable** when it is present, not empty and its confidence is at least `min_field_confidence` (0.80).
For each document type the document with the lowest doc_id is used; the address proof is the lowest doc_id among
the three address-proof types.

## Rule map

| Rule | File                                     | Trigger                                                                                     | Needs                          | Config                                                      | Outcome | Reason code                 | Verified by               |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- | ------- | --------------------------- | ------------------------- |
| R1   | `rules/r01-document-missing.ts`          | No document of type PAN_CARD, or AADHAAR_CARD, or any address-proof type                    | classified doc_type            | `address_proof_types`                                       | REVIEW  | `DOCUMENT_MISSING`          | example 8                 |
| R2   | `rules/r02-document-type-mismatch.ts`    | Any classified doc_type differs from declared_doc_type                                      | doc_type, declared type        | -                                                           | REVIEW  | `DOCUMENT_TYPE_MISMATCH`    | example 8                 |
| R3   | `rules/r03-low-extraction-confidence.ts` | Any doc_type confidence < 0.80, or a required field of a selected document missing / < 0.80 | confidences, required fields   | `min_field_confidence`                                      | REVIEW  | `LOW_EXTRACTION_CONFIDENCE` | example 9                 |
| R4   | `rules/r04-age-below-minimum.ts`         | Completed years on application_date < minimum age                                           | declared dob, application_date | `min_age`                                                   | REJECT  | `AGE_BELOW_18`              | example 2                 |
| R5   | `rules/r05-pan-invalid.ts`               | Declared PAN fails the pattern, or 4th character is not the holder type                     | declared pan_number            | `pan_pattern`, `pan_holder_type_char`                       | REJECT  | `PAN_INVALID`               | sample A2000039, A2000050 |
| R6   | `rules/r06-pan-mismatch.ts`              | Usable pan_number on the PAN card differs from declared                                     | PAN card pan_number (usable)   | `min_field_confidence`                                      | REJECT  | `PAN_MISMATCH`              | examples 3, 9 (skipped)   |
| R7   | `rules/r07-dob-mismatch.ts`              | Usable dob on the PAN card or the Aadhaar card differs from declared                        | PAN / Aadhaar dob (usable)     | `min_field_confidence`                                      | REJECT  | `DOB_MISMATCH`              | golden                    |
| R8   | `rules/r08-aadhaar-mismatch.ts`          | Usable aadhaar_last4 differs from declared                                                  | Aadhaar last4 (usable)         | `min_field_confidence`                                      | REJECT  | `AADHAAR_MISMATCH`          | golden                    |
| R9   | `rules/r09-name-mismatch.ts`             | name_match_score < 0.75                                                                     | usable PAN / Aadhaar names     | `name_reject_below`, `name_title_tokens`                    | REJECT  | `NAME_MISMATCH`             | golden                    |
| R10  | `rules/r10-sanctions-match.ts`           | Sanctions screening result MATCH                                                            | full_name, dob, list           | `watchlist_match_threshold`, `name_title_tokens`            | REJECT  | `SANCTIONS_MATCH`           | example 6                 |
| R11  | `rules/r11-name-mismatch-minor.ts`       | 0.75 <= name_match_score < 0.90                                                             | name_match_score               | `name_reject_below`, `name_match_threshold`                 | REVIEW  | `NAME_MISMATCH_MINOR`       | example 4                 |
| R12  | `rules/r12-document-expired.ts`          | Address proof is a driving licence and valid_until < application_date                       | valid_until (usable)           | -                                                           | REVIEW  | `DOCUMENT_EXPIRED`          | unit tests                |
| R13  | `rules/r13-address-proof-stale.ts`       | Bill / bank statement dated > 90 days before application_date, or after it                  | document_date (usable)         | `address_proof_max_age_days`                                | REVIEW  | `ADDRESS_PROOF_STALE`       | example 5                 |
| R14  | `rules/r14-address-mismatch.ts`          | Usable pincode on the address proof differs from declared                                   | pincode (usable)               | `min_field_confidence`                                      | REVIEW  | `ADDRESS_MISMATCH`          | golden                    |
| R15  | `rules/r15-sanctions-possible.ts`        | Sanctions screening result POSSIBLE                                                         | full_name, dob, list           | `watchlist_match_threshold`, `watchlist_possible_threshold` | REVIEW  | `SANCTIONS_POSSIBLE_MATCH`  | unit tests                |
| R16  | `rules/r16-pep-match.ts`                 | PEP screening result MATCH                                                                  | full_name, dob, list           | `watchlist_match_threshold`                                 | REVIEW  | `PEP_MATCH`                 | example 7                 |
| R17  | `rules/r17-duplicate-customer.ts`        | Declared PAN exists in existing_customers                                                   | declared pan_number            | -                                                           | REVIEW  | `DUPLICATE_CUSTOMER`        | unit tests                |

Supporting code: `name.ts` (normalisation, Levenshtein, similarity, rounding), `dates.ts` (calendar-date age, days,
add years), `screening.ts`, `context.ts` (document selection, usable fields, name score), `risk.ts` (risk category,
re-KYC), `routing.ts` (decision → first status), `response.ts` (decision API response, spec 6.3).

Interactions: R4-R10 reject and R1-R3 / R11-R17 review, all evaluated together. R6, R7, R8, R9, R11-R14 depend on
usable fields (a low-confidence field skips them and R3 sends the case to REVIEW, so a misread cannot reject).
R15/R16 raise the risk to HIGH, which changes only risk and re-KYC, not the decision. HIGH risk + APPROVE routes to
PENDING_CHECKER.

Risk: HIGH if PEP_MATCH or SANCTIONS_POSSIBLE_MATCH triggered or occupation risk is HIGH; else MEDIUM if occupation
risk is MEDIUM or annual_income >= `medium_risk_income`; else LOW. Re-KYC = application_date + `rekyc_years[risk]`.

## Open questions and interpretations (flagged, not guessed silently)

1. **"Usable document" in R1.** The spec says R1 fires when there is no _usable_ document of a type but does not
   define usable for a whole document. The official expected results (for example sample A2000051 and A2000053, which have a low doc_type
   confidence) show such a document still counts as present and only R3 fires, so R1 means "no document of that
   classified type". Verified by the 60-row golden test.
2. **29 February.** "29 February moves to 28 February" is implemented as: only when the target year has no 29 February
   (2024-02-29 + 2 years = 2026-02-28; + 4 years = 2028-02-29). The spec text could also mean "always 28 February".
   No supplied example differs. Change in `dates.addYears` if the evaluators mean the stricter reading.
3. **PEP POSSIBLE.** The spec defines screening results for both lists but only a rule for PEP MATCH (R16). A PEP
   POSSIBLE result triggers nothing and does not raise risk. It is kept in `screening.pep` for the officer screen.
4. **Several watchlist entries.** The overall result is the strongest over all entries (MATCH over POSSIBLE); every hit
   is kept in the trace with its similarity and the dob comparison. Name and alias are compared and the better one used.
5. **Floating point at the thresholds.** Comparisons use a 1e-12 tolerance so a score that is exactly 0.90 on paper is
   not lost to representation error (for example `1 - 3/30`). Scores are never rounded before comparing.
6. **R6/R8/R14 comparison.** Strict equality of the extracted value (already normalised by the extractor) with the
   declared value; no case folding or trimming is added.
7. **Decision when nothing about a name is usable.** Score is empty, R9 and R11 are skipped, R3 normally fires.
8. **Occupation not in the table.** The engine throws instead of guessing a risk level.
9. **Checker/maker and corrections** (a corrected field keeps the case with the checker) are workflow behaviour and are
   tested in the workflow tests, not in the engine.
