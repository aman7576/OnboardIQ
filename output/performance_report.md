# Performance and concurrency report

Measured 2026-10-23 with `npm run perf` (backend/src/cli/perf.ts). Numbers are wall-clock
milliseconds on the machine below; a target is marked met only when the **maximum** is within it.

## Environment

- Darwin 25.6.0, Apple M5 (10 cores), 16 GB RAM
- Node v26.5.0; PostgreSQL 16.14 on aarch64-unknown-linux-musl; API and database on the same machine (Docker), HTTP over localhost
- Throw-away database loaded with the supplied files; mock extraction for the API run; no LLM configured

## Latency

| Measurement | n | p50 | p95 | max | Target | Result |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| One application through the API (`POST /submit`: extraction + rules R1-R17 + routing + audit, mock provider) | 158 | 17.0 | 18.6 | 24.4 | 2,000 ms | met (max within target) |
| AI extraction per document, no LLM (all 474 supplied texts) | 474 | 10.6 | 15.4 | 18.5 | 1,000 ms | met (max within target) |
| Batch: 100 evaluation applications, real command incl. process start (3 runs) | 3 | 149.4 | 174.6 | 174.6 | 60,000 ms | met (max within target) |

API run outcomes over 158 applications: AUTO_REJECTED 27, IN_REVIEW 54, PENDING_CHECKER 5, AUTO_APPROVED 72. Batch wrote 100 rows.

The 10-second limit with an LLM is enforced by a timeout (tested with a provider that hangs); it is not measured
here because no LLM is configured.

## Concurrency

10 simultaneous `POST /applications/A2000001/submit` requests: **1** succeeded (200), **9** got 409, 0 other.
Result: only one succeeds; the others receive HTTP 409 (target met).
