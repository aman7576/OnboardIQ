# OnboardIQ

KYC onboarding for a fictional bank (HCLTech BFSI Engineering Challenge, Use Case 02).
**AI proposes, rules decide, humans approve.**

> Status: complete. Rules R1-R17 (60/60 sample rows exact), mock and AI extraction providers, maker-checker
> workflow, audit, dashboard, batch and AI-track outputs, 14 role-based screens, OpenAPI, design documents.
> Evidence and open points: [`output/qa_report.md`](output/qa_report.md).

## Project layout

```
OnboardIQ/
├── backend/                Express + TypeScript + Zod + Prisma (own package.json, tests, Dockerfile)
│   ├── prisma/             schema.prisma + SQL migrations
│   ├── src/
│   │   ├── server.ts, app.ts          start-up and wiring
│   │   ├── config/                    environment validation, paths
│   │   ├── db/                        Prisma client
│   │   ├── http/                      errors, validation, request log, secret redaction
│   │   ├── modules/                   one folder per feature
│   │   │   ├── auth/                  login, sessions, password hashing, role guards
│   │   │   ├── applications/          object-level access policy, masking, application + document routes
│   │   │   ├── workflow/              status table, recommendation, checker decision (maker-checker)
│   │   │   ├── admin/                 rule configuration, watchlists, audit trail (Compliance Officer)
│   │   │   ├── documents/             upload validation, disk storage, SHA-256 de-duplication
│   │   │   ├── extraction/            provider interface, mock provider, timeout/fallback, extract endpoint
│   │   │   ├── internal/              simulated core-banking service (service key only)
│   │   │   ├── audit/                 append-only audit writes
│   │   │   └── health/
│   │   ├── import/                    CSV/JSON/JSONL importer (validate first, one transaction per target)
│   │   └── cli/                       db:seed, import, db:reset, db:seed-users, db:check
│   └── test/
│       ├── unit/                      pure logic, no database
│       ├── integration/               real app + PostgreSQL test database
│       └── support/                   fixtures, helpers, global setup
├── frontend/               React + Vite + Tailwind (own package.json, tests, Dockerfile)
│   └── src/
│       ├── api/                       fetch client, auth + health calls
│       ├── features/                  auth/ (login, session), home/, system-status/
│       ├── components/                layout/ and ui/
│       └── lib/, test/
├── csvFiles/               supplied data pack (read-only input, never modified)
└── docker-compose.yml, .env.example, package.json (root tooling), eslint.config.mjs
```

## Where the spec deliverables are

The spec names a `/code` folder; we keep the two applications at the repository root so each runs on its own.

| Spec deliverable                                                                                      | Location                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/code` (source, seed scripts, mock extraction and core-banking services, tests, Dockerfile, compose) | `backend/`, `frontend/`, `docker-compose.yml`, root `package.json` |
| `/output` decisions, extraction, AI decisions, evaluation report, model card                          | `output/` (`npm run outputs`)                                      |
| `/output/design` design document, OpenAPI, lifecycle and ER diagrams                                  | `output/design/` (`npm run design`)                                |
| `/prompt` (optional)                                                                                  | `prompt/`                                                          |
| QA evidence and performance                                                                           | `output/qa_report.md`, `output/performance_report.md`              |

## Prerequisites

- Node.js 22 or newer (`node -v`)
- Docker Desktop running (PostgreSQL, and the optional full-stack run)

## Setup

```bash
cp .env.example .env
```

Replace every `change-me` value in `.env` (generate secrets with `openssl rand -hex 32`; use the same
password in `POSTGRES_PASSWORD` and `DATABASE_URL`). `.env` is git-ignored.

```bash
npm run install:all     # root tooling + backend + frontend
npm run db:up           # PostgreSQL in Docker
npm run db:migrate      # create the tables
npm run db:seed         # import the data pack + create the demo accounts
```

| Environment | Where variables come from                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| development | repo-root `.env`, read by the backend at start                                                                 |
| test        | none needed: tests build their own config and use a separate `<db>_test` database                              |
| production  | the runtime only (`docker compose` injects them); `.env` files are not read and `change-me` values are refused |

A missing or invalid variable stops the backend with a list of every problem.

## Run

Everything together (two processes, one terminal):

```bash
npm run dev
```

Or each side on its own, from its own folder:

```bash
cd backend && npm run dev     # API on http://localhost:3000
```

```bash
cd frontend && npm run dev    # UI on http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173. Without the backend running, the UI still loads and shows the backend as Down.

All in Docker instead: `docker compose up --build`, then open http://localhost:8080.

## Demo accounts

`npm run db:seed` (or `npm run db:seed-users`) creates these accounts, all with the password in
`SEED_DEMO_PASSWORD` from your `.env`. Nothing is created when `NODE_ENV=production`.

| E-mail                      | Role                         | Notes                            |
| --------------------------- | ---------------------------- | -------------------------------- |
| `applicant1@onboardiq.test` | Applicant                    | owns sample application A2000001 |
| `applicant2@onboardiq.test` | Applicant                    | owns sample application A2000002 |
| `officer1@onboardiq.test`   | KYC Officer (maker)          |                                  |
| `officer2@onboardiq.test`   | KYC Officer (maker)          |                                  |
| `checker1@onboardiq.test`   | Compliance Officer (checker) |                                  |
| `checker2@onboardiq.test`   | Compliance Officer (checker) |                                  |

`npm run dev` lists these on the sign-in page (development builds only).

## Security model

- **Passwords:** scrypt (N=2^15, r=8, p=3), per-user salt, parameters stored in each hash.
- **Sessions:** server-side. Login returns a random 256-bit bearer token valid for `SESSION_TTL_MINUTES`
  (default 60). Only an HMAC of the token is stored, so a database leak yields no usable tokens. Logout
  revokes the session; disabling a user ends their sessions at once.
- **Brute force:** 5 failed logins per client and e-mail lock that pair for 15 minutes (429).
  Wrong e-mail and wrong password give the same 401 and take the same time.
- **Roles are enforced on the server** (Applicant, KYC Officer, Compliance Officer). The UI only hides things.
- **Object-level checks:** an applicant reaches only their own applications and documents; a KYC Officer
  reaches cases in `IN_REVIEW`, `PENDING_CHECKER` and `RESUBMISSION_REQUESTED`; a Compliance Officer reaches all.
  Anything else answers 404, identical to "does not exist", so ids cannot be probed. Document ids are checked
  against the application in the URL.
- **Maker-checker:** the user who recommended a case cannot also check it (403). Concurrent decisions use
  a version column: the second gets 409.
- **Masking:** PAN is `ZZKXXXXX4Q` in lists; the full PAN appears only on the officer case screen. Only the
  last 4 Aadhaar digits exist anywhere. Applicants never receive confidence scores or watchlist data.
- **Audit:** append-only (a database trigger blocks UPDATE and DELETE). Logins, failures, logouts, access
  denials, document views, status changes, decisions and configuration changes are recorded in the same
  transaction as the change.
- **Logs:** one line per request (method, path, status, time, user id). No headers, bodies or query strings,
  so passwords, tokens, PAN and document text cannot reach the log. Errors pass through a redactor.
- **Simulated services** live under `/internal`, not `/api`, and need the `x-service-key` header
  (`CORE_BANKING_SERVICE_KEY`). A user token does not open them.

## API contract

| Situation                                                | Status                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Missing, invalid, expired or revoked token; bad login    | 401                                                                                  |
| Role not allowed (e.g. Applicant calls an officer API)   | 403 `FORBIDDEN_ROLE`                                                                 |
| Maker tries to check their own case                      | 403 `MAKER_CHECKER_SAME_USER`                                                        |
| Application/document not yours, not in scope, or missing | 404                                                                                  |
| Invalid input (names the offending fields)               | 400                                                                                  |
| Rejected file: too large, not .txt, not UTF-8, too few   | 422 (`FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `INVALID_ENCODING`, `TOO_FEW_FILES`) |
| Wrong case state, or lost a concurrent update            | 409                                                                                  |
| Too many failed logins                                   | 429                                                                                  |

| Endpoint (prefix `/api/v1`)                                                                | Who                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `POST /auth/register`, `POST /auth/login`                                                  | anyone (register creates an Applicant)                                     |
| `POST /auth/logout`, `GET /auth/me`                                                        | signed in                                                                  |
| `GET /applications/mine`                                                                   | Applicant                                                                  |
| `GET /applications/:id`, `/documents`, `/documents/:docId`                                 | owner, or an officer in scope (each document view is audited)              |
| `GET /review/queue`                                                                        | KYC Officer (IN_REVIEW), Compliance Officer (PENDING_CHECKER)              |
| `POST /applications/:id/documents` (multipart: `files` + one `declared_doc_type` per file) | Applicant (owner); `.txt`, UTF-8, ≤ 1 MB; first submission needs ≥ 3 files |
| `POST /documents/:docId/extract`                                                           | service key (`x-service-key`) or KYC / Compliance Officer                  |
| `POST /applications/:id/recommendation`                                                    | KYC Officer                                                                |
| `POST /applications/:id/checker-decision`                                                  | Compliance Officer                                                         |
| `POST /admin/rescreen`, `POST /admin/expire-overdue`, `GET /admin/rekyc-due?days=30`       | Compliance Officer                                                         |
| `GET/PUT /admin/rule-config`, `/admin/watchlists/{sanctions,pep}`, `GET /admin/audit/:id`  | Compliance Officer                                                         |
| `POST /internal/core-banking/accounts` (not under `/api`)                                  | service key only                                                           |

## Documents and extraction

- Uploaded files are stored under `STORAGE_DIR` (default `<repo>/storage`, outside `frontend/`, never served
  statically), mode 0600, and the text is kept in the `documents` table with its SHA-256. The same content
  uploaded again for the same application returns the original document instead of a duplicate.
- Document text is untrusted data: it is validated as bytes, stored, and returned only as a JSON string. No
  code path interprets it; the mock extractor does not even read it.
- `EXTRACTION_PROVIDER=mock` looks documents up in the supplied `extraction_mock` files by `doc_id`; an unknown
  document is `OTHER` with confidence 0.00. `ai` is not part of this build: it degrades the same way (OTHER, 0.00,
  version `ai:unavailable`) instead of failing, as does any provider error or a 10 s timeout.
- Providers receive only `{ docId, text }`; `declared_doc_type` is never an input.

## Application workflow

```
SUBMITTED -> EXTRACTING -> AUTO_APPROVED | PENDING_CHECKER | IN_REVIEW | AUTO_REJECTED     (rules decide)
IN_REVIEW -> PENDING_CHECKER (recommendation or field correction) | RESUBMISSION_REQUESTED
RESUBMISSION_REQUESTED -> SUBMITTED (applicant re-uploads) | CLOSED_EXPIRED (7 days)
PENDING_CHECKER -> APPROVED | REJECTED | IN_REVIEW (sent back)
```

- Every status change goes through one function with a version check and an audit row on the same transaction, so
  two conflicting actions on a case cannot both succeed (the second gets 409) and an invalid move is refused.
- Maker and checker must differ: whoever recommended or corrected a case cannot check it (403).
- Auto-approval (and final approval) opens the simulated core-banking account and records the re-KYC due date.
- "Resubmission": documents re-uploaded in the new round replace earlier documents declared as the same type.
- `POST /admin/rescreen` re-runs the rules for open cases against the current lists; statuses are not changed.
- Batch: `npm run batch` writes `output/decisions_output.csv` from the same engine (`--dataset sample` verifies the
  60 sample rows against their expected columns).

## Deliverable outputs (spec 6.3 and 6.6)

```bash
npm run outputs -- --fresh-db   # new empty database -> migrate -> import -> generate -> validate (repeatable from clean)
npm run outputs                 # same, from the database you already seeded (npm run db:seed first)
npm run outputs -- --source files   # straight from the supplied files, no database
npm run outputs:validate        # checks the files in output/ against the spec and the inputs
npm run outputs:repeat          # runs the pipeline twice on two new empty databases and compares every file by SHA-256
```

Writes to `output/`: `decisions_output.csv` (mock extraction), and for the AI track `extraction_output.csv`,
`ai_decisions_output.csv`, `evaluation_report.md`, `model_card.md`. It also writes `sample/decisions_sample_output.csv`
(checked against the sample's expected columns) and `validation_report.json`. There are no timestamps in any file, so the
same inputs, database state and configuration give byte-identical output. The supplied input files are never written to.

## AI extraction provider

`EXTRACTION_PROVIDER=ai` selects deterministic rules (injection guard, weighted classifier, OCR repair, validators,
calibrated confidence) with an optional LLM that only proposes structured JSON (`EXTRACTION_LLM=anthropic`, `ANTHROPIC_API_KEY`,
off by default). It never decides; on failure or timeout (10 s) a document becomes OTHER with confidence 0. The mock provider is
unchanged (`mock`). See `output/model_card.md` and `output/evaluation_report.md` for measured results and limits.

## Database and data import

The importer reads the supplied files in `csvFiles/` (read-only), validates every row first, and writes a target
in one transaction, or not at all. Re-running is safe.

```bash
npm run import -- sample       # or: reference | eval | --all (always runs in dependency order)
npm run db:reset -- --confirm  # DESTRUCTIVE: drop everything, re-migrate, re-import, re-seed users
```

- A known id arriving with different content, a duplicate id, a malformed row or a missing foreign key is
  rejected with file and line, and that target writes nothing.
- Imported tables keep the source column names. Sample and evaluation data are kept apart (`dataset` column).
- `db:reset` refuses to run without `--confirm`, in production, or against a non-local database. Prisma also
  blocks the underlying reset when invoked by an AI agent; a person runs it.

## Quality checks

One command runs everything (typecheck, lint, format check, all tests, both builds):

```bash
npm run check
```

Further evidence commands (each uses its own throw-away database where it needs one):

```bash
npm run e2e                     # Chrome: applicant -> officer -> checker, registration, maintenance
npm run outputs -- --fresh-db   # regenerate /output deliverables from a new database, then validate them
npm run outputs:repeat          # generate twice from two empty databases and compare every file byte for byte
npm run perf                    # latency, batch time and concurrency -> output/performance_report.md
npm run design                  # output/design (OpenAPI, lifecycle, ER, design document) and /prompt
npm run batch                   # output/decisions_output.csv for the evaluation set (no database needed)
```

With the API running, the API documentation is at http://localhost:3000/api/docs (Swagger UI).
LLMs are optional and off by default. To use Groq, add to `.env` and restart the API:

```bash
GROQ_API_KEY=gsk_...             # from console.groq.com
REVIEW_SUMMARY_LLM=groq          # AI-5 discrepancy summary on REVIEW cases
EXTRACTION_LLM=groq              # optional: LLM help for EXTRACTION_PROVIDER=ai
GROQ_MODEL=openai/gpt-oss-120b
```

The start-up line shows which LLM each feature uses. The AI never decides: summaries and extraction proposals are
schema-checked, and anything that fails a guardrail is withheld.

Imported applications arrive as Submitted. `npm run db:seed` processes them (extraction + rules + routing) so the
queues and dashboard have data; on an existing database run `npm run db:process` once, or use
**Maintenance → Process received applications**.

Or individually, from the root (both sides) or from `backend/` / `frontend/` (that side only):

```bash
npm test               # backend (Vitest + Supertest, PostgreSQL test database) + frontend (Vitest + Testing Library)
npm run typecheck      # strict TypeScript
npm run lint           # ESLint (no-explicit-any is an error)
npm run format:check   # Prettier
npm run build
```

Backend integration tests create their own `<db>_test` database automatically; if PostgreSQL is not running
they are skipped with a warning.

## Notes

- npm 11 asks for approval of package install scripts; the needed ones (Prisma engines, esbuild) are listed
  under `allowScripts` in `backend/package.json`.
- The UI follows the RetailPulse storefront look: ivory / ink / forest colours, Fraunces + Geist fonts.
- Session tokens are kept in `sessionStorage` (cleared when the tab closes). The app must never render untrusted HTML.

## Frontend screens and browser tests

Fourteen screens (the eleven below plus registration, compliance maintenance and the AI-5 summary card) use the real API only (no hard-coded numbers or decisions): login, applicant dashboard, new application,
document upload, application details, officer review queue, case review with field correction, checker queue,
compliance dashboard, audit viewer, AI evaluation results. Navigation depends on the role for convenience only; the
backend authorises every request.

```bash
npm --prefix frontend test        # component tests (jsdom)
npm run e2e                       # Chrome tests of applicant -> officer correction -> different checker
```

`npm run e2e` starts a throw-away API on its own database (`<db>_e2e`, dropped on exit) with `npm run e2e:server`
in `backend/`, plus Vite on port 5201. It uses the Chrome installed on the machine (`E2E_BROWSER=chromium` to use
Playwright's own browser). The AI evaluation screen needs `npm run outputs` to have been run.
