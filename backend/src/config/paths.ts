import { fileURLToPath } from 'node:url';
import type { Env } from './env.js';

// backend/src/config -> repo root is three levels up (same from backend/dist/config).
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export const dataDir = (env: Pick<Env, 'DATA_DIR'>): string =>
  env.DATA_DIR ?? `${REPO_ROOT}csvFiles`;
export const outputDir = (env: Pick<Env, 'OUTPUT_DIR'>): string =>
  env.OUTPUT_DIR ?? `${REPO_ROOT}output`;
export const storageDir = (env: Env): string => env.STORAGE_DIR ?? `${REPO_ROOT}storage`;
