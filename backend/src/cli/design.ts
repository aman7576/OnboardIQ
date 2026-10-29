// npm run design: writes /output/design. The API contract, the status lifecycle and the ER diagram are generated
// from the code (routes' Zod schemas, the transition table, the Prisma schema), so they cannot drift from it.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiDocument } from '../docs/openapi.js';
import {
  SUMMARY_PROMPT_VERSION,
  SUMMARY_SYSTEM_PROMPT,
  SUMMARY_TOOL,
} from '../modules/ai-summary/summary.js';
import { LLM_JSON_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT } from '../modules/extraction/ai/llm.js';
import { TRANSITIONS } from '../modules/workflow/transitions.js';

const BACKEND = fileURLToPath(new URL('../..', import.meta.url));
const out = join(process.env.OUTPUT_DIR ?? join(BACKEND, '..', 'output'), 'design');

function lifecycle(): string {
  const final = Object.entries(TRANSITIONS)
    .filter(([, next]) => next.length === 0)
    .map(([s]) => s);
  const lines = ['stateDiagram-v2', '  [*] --> SUBMITTED'];
  for (const [from, next] of Object.entries(TRANSITIONS))
    for (const to of next) lines.push(`  ${from} --> ${to}`);
  for (const s of final) lines.push(`  ${s} --> [*]`);
  return [
    '# Application status lifecycle',
    '',
    'Generated from `backend/src/modules/workflow/transitions.ts` (spec 6.1.1). Any other change is refused with HTTP 409.',
    '',
    '```mermaid',
    ...lines,
    '```',
    '',
    `Final statuses: ${final.join(', ')}.`,
    '',
  ].join('\n');
}

function erDiagram(): string {
  const schema = readFileSync(join(BACKEND, 'prisma', 'schema.prisma'), 'utf8');
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1] ?? '',
    body: m[2] ?? '',
  }));
  const tableOf = new Map(
    models.map((m) => [m.name, /@@map\("(\w+)"\)/.exec(m.body)?.[1] ?? m.name]),
  );
  const lines = ['erDiagram'];
  const rels: string[] = [];
  for (const { name, body } of models) {
    const table = tableOf.get(name) ?? name;
    const cols: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const m = /^(\w+)\s+(\w+)(\[\])?\??(.*)$/.exec(line);
      if (!m || line.startsWith('@@') || line.startsWith('//')) continue;
      const [, field = '', type = '', list, rest = ''] = m;
      const target = tableOf.get(type);
      if (target) {
        const fk = /@relation\(fields: \[(\w+)\]/.exec(rest);
        if (fk && !list) rels.push(`  ${target} ||--o{ ${table} : "${fk[1] ?? ''}"`);
        continue;
      }
      const key = rest.includes('@id') ? ' PK' : rest.includes('@unique') ? ' UK' : '';
      cols.push(`    ${type} ${field}${key}`);
    }
    lines.push(`  ${table} {`, ...cols, '  }');
  }
  return [
    '# ER diagram',
    '',
    'Generated from `backend/prisma/schema.prisma`. `audit_events` is append-only (database trigger); `documents` is unique on (application_id, sha256).',
    '',
    '```mermaid',
    ...lines,
    ...rels,
    '```',
    '',
  ].join('\n');
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'openapi.json'), `${JSON.stringify(openApiDocument(), null, 2)}\n`);
writeFileSync(join(out, 'status_lifecycle.md'), lifecycle());
writeFileSync(join(out, 'er_diagram.md'), erDiagram());
copyFileSync(join(BACKEND, 'src', 'docs', 'design_document.md'), join(out, 'design_document.md'));
// Spec deliverable (optional): /prompt with the prompts used for LLM extraction and the reviewer summary.
const prompts = join(BACKEND, '..', 'prompt');
mkdirSync(prompts, { recursive: true });
const promptDoc = (title: string, version: string, system: string, user: string, schema: unknown) =>
  [
    `# ${title}`,
    '',
    `Prompt version \`${version}\`. Generated from the code by \`npm run design\`; the model answers only through a tool with this JSON schema.`,
    '',
    '## System prompt',
    '',
    '```text',
    system,
    '```',
    '',
    '## User message',
    '',
    '```text',
    user,
    '```',
    '',
    '## Answer schema',
    '',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    '',
  ].join('\n');
writeFileSync(
  join(prompts, 'llm_extraction_prompt.md'),
  promptDoc(
    'LLM extraction prompt (optional part of the "ai" provider)',
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    'Extract from the document below.\n<<<DOCUMENT <random token>\n<document text>\nDOCUMENT <random token>>>>',
    LLM_JSON_SCHEMA,
  ),
);
writeFileSync(
  join(prompts, 'review_summary_prompt.md'),
  promptDoc(
    'AI-5 reviewer summary prompt',
    SUMMARY_PROMPT_VERSION,
    SUMMARY_SYSTEM_PROMPT,
    'Summarise the discrepancies of this case.\n<<<FACTS <random token>\n<facts JSON built by code from the rule trace>\nFACTS <random token>>>>',
    SUMMARY_TOOL.schema,
  ),
);

console.log(
  `Design files written to ${out}: design_document.md, openapi.json, status_lifecycle.md, er_diagram.md`,
);
