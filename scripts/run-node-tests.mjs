import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'out', 'test', 'unit');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(dir, f));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
