// OpenAPI 3.1 description of the REST API (spec deliverable: API documentation). Request bodies are generated
// from the same Zod schemas the routes validate with, so the contract cannot drift from the validation.
// Served at GET /api/v1/openapi.json and rendered at /api/docs; `npm run design` writes it to output/design.
import { z } from 'zod';
import { loginBody, registerBody } from '../modules/auth/schemas.js';
import { applicationBody, correctionsBody } from '../modules/workflow/application.schemas.js';
import { checkerBody, recommendationBody } from '../modules/workflow/workflow.schemas.js';

type Method = 'get' | 'post' | 'put' | 'delete';
type Who =
  'public' | 'any' | 'APPLICANT' | 'KYC_OFFICER' | 'COMPLIANCE_OFFICER' | 'OFFICERS' | 'SERVICE';

interface Op {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  who: Who;
  body?: z.ZodType | 'multipart' | Record<string, unknown>;
  ok: number;
  errors?: number[];
  query?: { name: string; schema: Record<string, unknown>; description: string }[];
}

const PAN = '^[A-Z]{5}[0-9]{4}[A-Z]$'; // default; the live pattern comes from the active rule configuration
const date = { type: 'string', format: 'date' };

/** Every route of the application. A test checks that each one exists and that none is missing. */
export const OPERATIONS: Op[] = [
  {
    method: 'get',
    path: '/api/v1/health',
    tag: 'System',
    summary: 'Liveness of the API',
    who: 'public',
    ok: 200,
  },
  {
    method: 'get',
    path: '/api/v1/health/db',
    tag: 'System',
    summary: 'Database reachability and latency',
    who: 'public',
    ok: 200,
    errors: [503],
  },
  {
    method: 'get',
    path: '/api/v1/openapi.json',
    tag: 'System',
    summary: 'This document',
    who: 'public',
    ok: 200,
  },

  {
    method: 'post',
    path: '/api/v1/auth/register',
    tag: 'Auth',
    summary: 'Register an applicant account (role is always APPLICANT)',
    who: 'public',
    body: registerBody,
    ok: 201,
    errors: [400, 409],
  },
  {
    method: 'post',
    path: '/api/v1/auth/login',
    tag: 'Auth',
    summary: 'Sign in; returns an opaque bearer token (60 minutes)',
    who: 'public',
    body: loginBody,
    ok: 200,
    errors: [400, 401, 429],
  },
  {
    method: 'post',
    path: '/api/v1/auth/logout',
    tag: 'Auth',
    summary: 'Revoke the current session',
    who: 'any',
    ok: 204,
    errors: [401],
  },
  {
    method: 'get',
    path: '/api/v1/auth/me',
    tag: 'Auth',
    summary: 'The signed-in user',
    who: 'any',
    ok: 200,
    errors: [401],
  },
  {
    method: 'get',
    path: '/api/v1/reference/occupations',
    tag: 'Reference',
    summary: 'Occupations for the application form',
    who: 'any',
    ok: 200,
    errors: [401],
  },

  {
    method: 'post',
    path: '/api/v1/applications',
    tag: 'Applications',
    summary:
      'Create an application (FR-2). Aadhaar last 4 digits only; a 12-digit value is refused',
    who: 'APPLICANT',
    body: applicationBody(PAN, '2099-12-31'),
    ok: 201,
    errors: [400, 401, 403],
  },
  {
    method: 'get',
    path: '/api/v1/applications/mine',
    tag: 'Applications',
    summary: "The caller's own applications",
    who: 'APPLICANT',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'get',
    path: '/api/v1/applications/{applicationId}',
    tag: 'Applications',
    summary:
      'Application detail. Applicant: own case, plain-language reasons and timeline. Staff: extracted fields with confidence, rule trace, screening (decision response of spec 6.3)',
    who: 'any',
    ok: 200,
    errors: [401, 404],
  },
  {
    method: 'get',
    path: '/api/v1/applications/{applicationId}/documents',
    tag: 'Documents',
    summary: 'Document list (no text)',
    who: 'any',
    ok: 200,
    errors: [401, 404],
  },
  {
    method: 'get',
    path: '/api/v1/applications/{applicationId}/documents/{docId}',
    tag: 'Documents',
    summary: 'Document text; every view is audited (FR-9)',
    who: 'any',
    ok: 200,
    errors: [401, 404],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/documents',
    tag: 'Documents',
    summary:
      'Upload .txt documents (UTF-8, at most 1 MB each, at least 3 on first submission, one declared_doc_type per file). Same file again is not duplicated (SHA-256)',
    who: 'APPLICANT',
    body: 'multipart',
    ok: 201,
    errors: [400, 401, 403, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/submit',
    tag: 'Workflow',
    summary: 'Submit: SUBMITTED -> EXTRACTING -> routed by the rules',
    who: 'APPLICANT',
    ok: 200,
    errors: [401, 403, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/resubmit',
    tag: 'Workflow',
    summary: 'Resubmit after RESUBMISSION_REQUESTED (within the window); evaluated again',
    who: 'APPLICANT',
    ok: 200,
    errors: [401, 403, 404, 409, 422],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/corrections',
    tag: 'Workflow',
    summary:
      'Correct extracted fields, each with a reason (confidence 1.00, source OFFICER); rules re-run; case goes to the checker',
    who: 'KYC_OFFICER',
    body: correctionsBody,
    ok: 200,
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/recommendation',
    tag: 'Workflow',
    summary: 'Maker recommendation (comment at least 10 characters)',
    who: 'KYC_OFFICER',
    body: recommendationBody,
    ok: 201,
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: 'post',
    path: '/api/v1/applications/{applicationId}/checker-decision',
    tag: 'Workflow',
    summary:
      'Checker decision; maker and checker must differ (403); APPROVE opens the account through mock core banking',
    who: 'COMPLIANCE_OFFICER',
    body: checkerBody,
    ok: 200,
    errors: [400, 401, 403, 404, 409],
  },
  {
    method: 'get',
    path: '/api/v1/review/queue',
    tag: 'Workflow',
    summary:
      'Officer: IN_REVIEW queue; Compliance Officer: PENDING_CHECKER queue. HIGH risk first, then oldest',
    who: 'OFFICERS',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'get',
    path: '/api/v1/applications/{applicationId}/ai-summary',
    tag: 'AI',
    summary:
      'AI-5 reviewer summary of a case under review (AI-generated, at most 80 words, never a recommendation). 503 when no LLM is configured',
    who: 'OFFICERS',
    ok: 200,
    errors: [401, 403, 404, 409, 503],
  },

  {
    method: 'post',
    path: '/api/v1/documents/{docId}/extract',
    tag: 'Extraction',
    summary:
      'FR-3 extraction interface: doc_type and fields with confidence (long format). Provider chosen by EXTRACTION_PROVIDER (mock | ai). Backend calls with x-service-key; officers may re-run',
    who: 'SERVICE',
    ok: 200,
    errors: [401, 403, 404],
  },

  {
    method: 'get',
    path: '/api/v1/admin/rule-config',
    tag: 'Compliance',
    summary: 'Active rule configuration',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'put',
    path: '/api/v1/admin/rule-config',
    tag: 'Compliance',
    summary: 'Activate a new configuration version (old one kept, audited)',
    who: 'COMPLIANCE_OFFICER',
    body: {
      type: 'object',
      description: 'Full configuration as in case_02_rules_config_V1.0.json, with a new version',
    },
    ok: 201,
    errors: [400, 401, 403, 409],
  },
  {
    method: 'get',
    path: '/api/v1/admin/watchlists/sanctions',
    tag: 'Compliance',
    summary: 'Sanctions list',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'post',
    path: '/api/v1/admin/watchlists/sanctions',
    tag: 'Compliance',
    summary: 'Add a sanctions entry',
    who: 'COMPLIANCE_OFFICER',
    body: {
      type: 'object',
      required: ['list_id', 'name', 'nationality', 'program'],
      properties: {
        list_id: { type: 'string' },
        name: { type: 'string' },
        alias: { type: 'string' },
        dob: date,
        nationality: { type: 'string' },
        program: { type: 'string' },
      },
    },
    ok: 201,
    errors: [400, 401, 403, 409],
  },
  {
    method: 'delete',
    path: '/api/v1/admin/watchlists/sanctions/{id}',
    tag: 'Compliance',
    summary: 'Remove a sanctions entry',
    who: 'COMPLIANCE_OFFICER',
    ok: 204,
    errors: [401, 403, 404],
  },
  {
    method: 'get',
    path: '/api/v1/admin/watchlists/pep',
    tag: 'Compliance',
    summary: 'PEP list',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'post',
    path: '/api/v1/admin/watchlists/pep',
    tag: 'Compliance',
    summary: 'Add a PEP entry',
    who: 'COMPLIANCE_OFFICER',
    body: {
      type: 'object',
      required: ['pep_id', 'name', 'dob', 'position', 'category'],
      properties: {
        pep_id: { type: 'string' },
        name: { type: 'string' },
        dob: date,
        position: { type: 'string' },
        category: { enum: ['DOMESTIC', 'RCA'] },
      },
    },
    ok: 201,
    errors: [400, 401, 403, 409],
  },
  {
    method: 'delete',
    path: '/api/v1/admin/watchlists/pep/{id}',
    tag: 'Compliance',
    summary: 'Remove a PEP entry',
    who: 'COMPLIANCE_OFFICER',
    ok: 204,
    errors: [401, 403, 404],
  },
  {
    method: 'post',
    path: '/api/v1/admin/rescreen',
    tag: 'Compliance',
    summary:
      'Re-screen open cases against the current lists and configuration (statuses unchanged)',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'post',
    path: '/api/v1/admin/process-received',
    tag: 'Compliance',
    summary:
      'Process the received (SUBMITTED) applications of the data pack: extraction + rules + routing, as a submission does',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'post',
    path: '/api/v1/admin/expire-overdue',
    tag: 'Compliance',
    summary: 'Close RESUBMISSION_REQUESTED cases past the window (CLOSED_EXPIRED)',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403],
  },
  {
    method: 'get',
    path: '/api/v1/admin/rekyc-due',
    tag: 'Compliance',
    summary: 'Approved customers whose re-KYC is due within N days',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [400, 401, 403],
    query: [
      {
        name: 'days',
        schema: { type: 'integer', minimum: 0, default: 30 },
        description: 'Window in days',
      },
    ],
  },
  {
    method: 'get',
    path: '/api/v1/admin/dashboard',
    tag: 'Compliance',
    summary: 'FR-10 dashboard figures (definitions included in the response)',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [400, 401, 403],
    query: [
      { name: 'from', schema: date, description: 'application_date from' },
      { name: 'to', schema: date, description: 'application_date to' },
    ],
  },
  {
    method: 'get',
    path: '/api/v1/admin/audit/{applicationId}',
    tag: 'Compliance',
    summary: 'Audit trail of an application, oldest first; ?format=csv exports it',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403, 404],
    query: [
      {
        name: 'format',
        schema: { enum: ['json', 'csv'] },
        description: 'csv for the audit export',
      },
    ],
  },
  {
    method: 'get',
    path: '/api/v1/admin/ai-evaluation',
    tag: 'Compliance',
    summary: 'Generated evaluation metrics, report and model card',
    who: 'COMPLIANCE_OFFICER',
    ok: 200,
    errors: [401, 403, 404],
  },

  {
    method: 'post',
    path: '/internal/core-banking/accounts',
    tag: 'Simulated services',
    summary:
      'Mock core banking: customer ID and account number for an APPROVED application (x-service-key)',
    who: 'SERVICE',
    body: {
      type: 'object',
      required: ['application_id'],
      properties: { application_id: { type: 'string' } },
    },
    ok: 201,
    errors: [401, 409],
  },
];

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No content',
  400: 'Invalid input; `fields` names each bad field',
  401: 'Not signed in, or invalid service key',
  403: 'Role not allowed (or maker = checker)',
  404: 'Not found, or not yours (no data is revealed)',
  409: 'Wrong status, already exists, or someone else changed the case first (optimistic locking)',
  422: 'File or business validation failed',
  429: 'Too many failed logins',
  503: 'Dependency unavailable',
};

const WHO_TEXT: Record<Who, string> = {
  public: 'No authentication.',
  any: 'Any signed-in user; objects are filtered by ownership/role.',
  APPLICANT: 'Applicant only.',
  KYC_OFFICER: 'KYC Officer only.',
  COMPLIANCE_OFFICER: 'Compliance Officer only.',
  OFFICERS: 'KYC Officer or Compliance Officer.',
  SERVICE: 'Backend service key (x-service-key) or an officer.',
};

const jsonSchema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const params = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));
    const query = (op.query ?? []).map((q) => ({
      name: q.name,
      in: 'query',
      required: false,
      schema: q.schema,
      description: q.description,
    }));
    let requestBody: unknown;
    if (op.body === 'multipart')
      requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['files', 'declared_doc_type'],
              properties: {
                files: { type: 'array', items: { type: 'string', format: 'binary' } },
                declared_doc_type: {
                  type: 'array',
                  items: {
                    enum: [
                      'PAN_CARD',
                      'AADHAAR_CARD',
                      'ELECTRICITY_BILL',
                      'BANK_STATEMENT',
                      'DRIVING_LICENCE',
                    ],
                  },
                },
              },
            },
          },
        },
      };
    else if (op.body instanceof z.ZodType)
      requestBody = {
        required: true,
        content: { 'application/json': { schema: jsonSchema(op.body) } },
      };
    else if (op.body)
      requestBody = { required: true, content: { 'application/json': { schema: op.body } } };
    const responses = Object.fromEntries(
      [op.ok, ...(op.errors ?? [])].map((c) => [String(c), { description: STATUS_TEXT[c] ?? '' }]),
    );
    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: WHO_TEXT[op.who],
      ...(op.who === 'public'
        ? { security: [] }
        : op.who === 'SERVICE'
          ? { security: [{ serviceKey: [] }, { bearer: [] }] }
          : {}),
      ...(params.length || query.length ? { parameters: [...params, ...query] } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'OnboardIQ API',
      version: '1.0.0',
      description:
        'Savings-account onboarding for Deccan Digital Bank (HCLTech BFSI challenge, use case 02). AI proposes, rules decide, humans approve. Errors are JSON `{ error, message, fields? }`.',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Opaque session token from /auth/login',
        },
        serviceKey: { type: 'apiKey', in: 'header', name: 'x-service-key' },
      },
    },
    paths,
  };
}

/** Swagger UI page (assets from a pinned CDN version); only this page gets a CSP that allows them. */
export const SWAGGER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>OnboardIQ API</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script src="/api/docs/init.js"></script></body></html>`;
export const SWAGGER_INIT = `window.ui = SwaggerUIBundle({ url: '/api/v1/openapi.json', dom_id: '#ui' });`;
export const SWAGGER_CSP =
  "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";
