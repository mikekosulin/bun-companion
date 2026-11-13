import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type TreeSpec = Record<string, string | object>;

export async function createTree(spec: TreeSpec): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'bun-companion-')));
  await writeTree(dir, spec);
  return dir;
}

export async function writeTree(dir: string, spec: TreeSpec): Promise<void> {
  for (const [rel, content] of Object.entries(spec)) {
    const file = path.join(dir, ...rel.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export const BUN_LOCK = '{\n  "lockfileVersion": 1,\n  "workspaces": {},\n  "packages": {},\n}\n';

export function acmeWorkspace(overrides: TreeSpec = {}): TreeSpec {
  return {
    'package.json': {
      name: 'acme',
      private: true,
      workspaces: { packages: ['packages/*', 'apps/*'], catalog: { react: '^19.2.0' } },
      catalogs: { testing: { vitest: '^3.2.0' } },
      scripts: { lint: 'biome check .' },
    },
    'bun.lock': BUN_LOCK,
    'packages/core/package.json': {
      name: '@acme/core',
      version: '1.2.0',
      scripts: { build: 'tsc', test: 'bun test' },
      dependencies: { zod: '^4.1.0' },
    },
    'packages/ui/package.json': {
      name: '@acme/ui',
      version: '0.3.0',
      scripts: { build: 'tsc', storybook: 'storybook dev' },
      dependencies: { '@acme/core': 'workspace:*' },
      peerDependencies: { react: 'catalog:' },
    },
    'apps/web/package.json': {
      name: 'web',
      private: true,
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
      dependencies: { '@acme/ui': 'workspace:^', react: 'catalog:' },
      devDependencies: { vitest: 'catalog:testing' },
    },
    ...overrides,
  };
}
