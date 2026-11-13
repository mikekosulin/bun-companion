import { watch } from 'node:fs';
import * as path from 'node:path';
import { preferEsm } from './plugins';

const root = path.resolve(import.meta.dir, '..');
const watchMode = process.argv.includes('--watch');
const production = !watchMode && !process.argv.includes('--dev');

async function build(): Promise<boolean> {
  console.log('build: start');
  const result = await Bun.build({
    entrypoints: [path.join(root, 'src/extension.ts')],
    outdir: path.join(root, 'dist'),
    target: 'node',
    format: 'cjs',
    external: ['vscode'],
    plugins: [preferEsm],
    minify: production,
    sourcemap: production ? 'none' : 'linked',
  });
  for (const log of result.logs) console.error(log);
  if (result.success) {
    const size = result.outputs.reduce((n, o) => n + o.size, 0);
    console.log(`dist/extension.js ${(size / 1024).toFixed(1)} KB${production ? '' : ' (dev)'}`);
  }
  return result.success;
}

if (!(await build())) process.exit(1);

if (watchMode) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(path.join(root, 'src'), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => void build(), 100);
  });
  console.log('watching src/ ...');
}
