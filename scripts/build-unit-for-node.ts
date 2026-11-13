import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { Glob } from 'bun';
import { bunTestOnNode, preferEsm } from './plugins';

const root = path.resolve(import.meta.dir, '..');
const unitRoot = path.join(root, 'test/unit');
const outdir = path.join(root, 'out/test/unit');
const entrypoints = [...new Glob('*.test.ts').scanSync(unitRoot)].map((f) => path.join(unitRoot, f));

await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints,
  root: unitRoot,
  outdir,
  target: 'node',
  format: 'esm',
  naming: '[dir]/[name].mjs',
  plugins: [bunTestOnNode, preferEsm],
  sourcemap: 'inline',
});
for (const log of result.logs) console.error(log);
if (!result.success) process.exit(1);
console.log(`built ${entrypoints.length} unit test files for Node`);
