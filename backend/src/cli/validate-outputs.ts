// npm run outputs:validate [-- --dir DIR]: checks the generated files against the specification and the inputs.
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dataDir, outputDir } from '../config/paths.js';
import { validateOutputs } from '../outputs/validate.js';

const { values } = parseArgs({ options: { dir: { type: 'string' } } });
const dir = resolve(values.dir ?? outputDir({ OUTPUT_DIR: process.env.OUTPUT_DIR }));
const checks = validateOutputs(dir, dataDir({ DATA_DIR: process.env.DATA_DIR }));
for (const c of checks)
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${!c.ok && c.detail ? ` - ${c.detail}` : ''}`);
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed in ${dir}`);
process.exitCode = failed.length === 0 ? 0 : 1;
