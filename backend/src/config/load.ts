import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv, type Env } from './env.js';

// Repo-root .env (backend/src/config -> ../../../.env; same depth from backend/dist/config).
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * development: reads the repo-root .env if present.
 * test:        tests pass their own values; no file is read.
 * production:  variables must come from the runtime (docker compose / orchestrator), never a file.
 */
export function loadConfig(): Env {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'development' && existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  return parseEnv(process.env);
}
