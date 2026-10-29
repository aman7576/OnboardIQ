import { z } from 'zod';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

// Placeholder text used in .env.example; production must never run with it.
const PLACEHOLDER = 'change-me';

const required = (hint: string) =>
  z.string({
    error: (iss) =>
      iss.input === undefined ? `is required but not set (${hint})` : 'must be a string',
  });

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(NODE_ENVS, { error: `must be one of ${NODE_ENVS.join(', ')}` })
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: required('e.g. postgresql://user:pass@localhost:5432/onboardiq').regex(
      /^postgres(ql)?:\/\//,
      'must be a postgresql:// connection URL',
    ),
    // Keys the hash stored for each session token (sessions are server-side, not JWTs).
    SESSION_SECRET: required('generate one with: openssl rand -hex 32').min(
      32,
      'must be at least 32 characters',
    ),
    // "Short-lived": a session ends this many minutes after login, or at logout.
    SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
    // Password of the seeded demo accounts. Optional: without it no demo users are created.
    // Bank officers can register themselves only with this code; leave unset to switch officer sign-up off.
    STAFF_ENROLLMENT_CODE: z.string().min(12, 'must be at least 12 characters').optional(),
    SEED_DEMO_PASSWORD: z.string().min(12, 'must be at least 12 characters').optional(),
    CORE_BANKING_SERVICE_KEY: required('service key for the mock core-banking API').min(
      16,
      'must be at least 16 characters',
    ),
    // Data pack (read-only) and generated outputs. Defaults: <repo>/csvFiles and <repo>/output.
    DATA_DIR: z.string().optional(),
    OUTPUT_DIR: z.string().optional(),
    // Where uploaded document files are kept: outside the web root, never served statically.
    STORAGE_DIR: z.string().optional(),
    // Optional LLM that may assist the "ai" provider (it only proposes; validators and rules still decide).
    // Off by default: no document text leaves the system unless this is set to "anthropic".
    EXTRACTION_LLM: z
      .enum(['none', 'anthropic', 'groq'], { error: 'must be "none", "anthropic" or "groq"' })
      .default('none'),
    ANTHROPIC_API_KEY: z.string().min(20, 'looks too short to be an API key').optional(),
    EXTRACTION_LLM_MODEL: z.string().min(1).default('claude-haiku-5-5'),
    // AI-5 (optional): an LLM writes a short reviewer summary of a REVIEW case from the rule results only.
    REVIEW_SUMMARY_LLM: z
      .enum(['none', 'anthropic', 'groq'], { error: 'must be "none", "anthropic" or "groq"' })
      .default('none'),
    // Groq (OpenAI-compatible API) as an alternative LLM provider for either feature.
    GROQ_API_KEY: z.string().min(20, 'looks too short to be an API key').optional(),
    GROQ_MODEL: z.string().min(1).default('openai/gpt-oss-120b'),
    // Applicant chatbot: on whenever GROQ_API_KEY is set.
    GROQ_CHAT_MODEL: z.string().min(1).default('qwen/qwen3.8-27b'),
    // FR-3: provider is chosen by configuration, not code.
    EXTRACTION_PROVIDER: z
      .enum(['mock', 'ai'], { error: 'must be "mock" or "ai"' })
      .default('mock'),
  })
  .superRefine((env, ctx) => {
    for (const feature of ['EXTRACTION_LLM', 'REVIEW_SUMMARY_LLM'] as const) {
      const kind = env[feature];
      const key =
        kind === 'anthropic' ? 'ANTHROPIC_API_KEY' : kind === 'groq' ? 'GROQ_API_KEY' : null;
      if (key && !env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `is required when ${feature}=${kind}`,
        });
    }
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'CORE_BANKING_SERVICE_KEY'] as const) {
      if (env[key].includes(PLACEHOLDER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `still contains the "${PLACEHOLDER}" placeholder from .env.example`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
        'Copy .env.example to .env and fill in the values (see README).',
    );
    this.name = 'ConfigError';
  }
}

/** Pure: validates a raw env map. Empty strings count as "not set". */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  );
}
