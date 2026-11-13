import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { preferEsm } from './plugins';

const root = path.resolve(import.meta.dir, '..');
const testRoot = path.join(root, 'test/integration');
const outdir = path.join(root, 'out/test/integration');
const suites = ['basic', 'single', 'multiRoot', 'notBun'];

await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: suites.map((s) => path.join(testRoot, s, 'suite.ts')),
  root: testRoot,
  outdir,
  target: 'node',
  format: 'cjs',
  external: ['vscode'],
  plugins: [preferEsm],
  sourcemap: 'inline',
});
for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
console.log(`built ${suites.length} integration suites`);
