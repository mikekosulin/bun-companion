import { afterEach, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { parseManifest } from '../../src/core/manifest';
import {
  detectBun,
  expandWorkspacePatterns,
  findWorkspaceRoots,
  loadWorkspace,
} from '../../src/core/workspace';
import { acmeWorkspace, BUN_LOCK, createTree, removeTree, type TreeSpec } from '../helpers/tree';

const created: string[] = [];
async function tree(spec: TreeSpec): Promise<string> {
  const dir = await createTree(spec);
  created.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(created.splice(0).map(removeTree));
});

const rel = (root: string, dirs: string[]) =>
  dirs.map((d) => path.relative(root, d).split(path.sep).join('/'));
const pkg = (name?: string) => (name === undefined ? {} : { name });

describe('detectBun', () => {
  const m = (value: object) => {
    const r = parseManifest(JSON.stringify(value));
    if (!r.ok) throw new Error();
    return r.manifest;
  };

  test.each([
    [{ 'bun.lock': BUN_LOCK }, {}, 'bun.lock'],
    [{ 'bun.lockb': '#!/usr/bin/env bun\n' }, {}, 'bun.lockb'],
    [{ 'bunfig.toml': '[install]\n' }, {}, 'bunfig.toml'],
    [{}, { packageManager: 'bun@1.4.2' }, 'packageManager'],
    [{ 'bun.lock': BUN_LOCK, 'bun.lockb': 'x' }, {}, 'bun.lock'],
  ] as const)('%p + %p -> %p', async (files, manifest, expected) => {
    const root = await tree({ ...files, 'package.json': {} });
    expect(await detectBun(root, m(manifest))).toBe(expected);
  });

  test('not Bun: pnpm/npm workspaces or another packageManager', async () => {
    const root = await tree({ 'package.json': {}, 'pnpm-lock.yaml': '', 'package-lock.json': '{}' });
    expect(await detectBun(root, m({ packageManager: 'pnpm@9.0.0' }))).toBeUndefined();
  });

  test('a directory named bun.lock does not count', async () => {
    const root = await tree({ 'package.json': {}, 'bun.lock/keep': '' });
    expect(await detectBun(root, m({}))).toBeUndefined();
  });
});

describe('findWorkspaceRoots', () => {
  test('the opened folder is the root', async () => {
    const root = await tree(acmeWorkspace());
    expect(await findWorkspaceRoots(root)).toEqual([root]);
  });

  test('walks up from a package folder to the root, like bun run --filter', async () => {
    const root = await tree(acmeWorkspace());
    expect(await findWorkspaceRoots(path.join(root, 'packages', 'ui'))).toEqual([root]);
  });

  test('stops at the first ancestor with workspaces, even when it is not Bun', async () => {
    const root = await tree({
      'package.json': { workspaces: ['packages/*'] },
      'pnpm-lock.yaml': '',
      'packages/a/package.json': pkg('a'),
    });
    expect(await findWorkspaceRoots(path.join(root, 'packages', 'a'))).toEqual([]);
  });

  test('searches two levels down when no ancestor is a workspace', async () => {
    const outer = await tree({
      'package.json': { name: 'tooling-repo' },
      'examples/playground/package.json': { workspaces: ['packages/*'] },
      'examples/playground/bun.lock': BUN_LOCK,
      'app/package.json': { workspaces: ['*'], packageManager: 'bun@1.4.0' },
      'test/fixtures/deep/package.json': { workspaces: ['*'] },
      'test/fixtures/deep/bun.lock': BUN_LOCK,
      'node_modules/x/package.json': { workspaces: ['*'] },
      'node_modules/x/bun.lock': BUN_LOCK,
    });
    expect(rel(outer, await findWorkspaceRoots(outer))).toEqual(['app', 'examples/playground']);
    expect(rel(outer, await findWorkspaceRoots(outer, { maxDepth: 3 }))).toEqual([
      'app',
      'examples/playground',
      'test/fixtures/deep',
    ]);
  });

  test('keeps only the outermost root when roots are nested', async () => {
    const outer = await tree({
      'package.json': { name: 'plain' },
      'mono/package.json': { workspaces: ['inner'] },
      'mono/bun.lock': BUN_LOCK,
      'mono/inner/package.json': { workspaces: ['*'] },
      'mono/inner/bun.lock': BUN_LOCK,
    });
    expect(rel(outer, await findWorkspaceRoots(outer))).toEqual(['mono']);
  });

  test('ignores invalid manifests and returns nothing for a plain project', async () => {
    const outer = await tree({ 'package.json': '{ broken', 'sub/package.json': { name: 'x' } });
    expect(await findWorkspaceRoots(outer)).toEqual([]);
  });
});

describe('expandWorkspacePatterns', () => {
  test('globs, literal paths, ./ prefixes and trailing slashes', async () => {
    const root = await tree({
      'packages/a/package.json': pkg('a'),
      'packages/b/package.json': pkg('b'),
      'packages/no-manifest/README.md': '',
      'tools/cli/package.json': pkg('cli'),
      'docs/package.json': pkg('docs'),
    });
    const dirs = await expandWorkspacePatterns(root, ['./packages/*/', 'tools/cli', 'docs/', 'missing']);
    expect(rel(root, dirs)).toEqual(['docs', 'packages/a', 'packages/b', 'tools/cli']);
  });

  test('negative patterns remove glob matches wherever they appear, but not literal paths', async () => {
    const root = await tree({
      'packages/a/package.json': pkg('a'),
      'packages/legacy/package.json': pkg('legacy'),
      'packages/a/fixtures/f/package.json': pkg('f'),
      'packages/kept/package.json': pkg('kept'),
    });
    const dirs = await expandWorkspacePatterns(root, [
      '!packages/legacy',
      'packages/**',
      '!packages/**/fixtures/**',
      '!packages/kept',
      'packages/kept',
    ]);
    expect(rel(root, dirs)).toEqual(['packages/a', 'packages/kept']);
  });

  test('never includes node_modules, .git or the root itself', async () => {
    const root = await tree({
      'package.json': pkg('root'),
      'packages/a/package.json': pkg('a'),
      'packages/a/node_modules/dep/package.json': pkg('dep'),
      '.git/x/package.json': pkg('git'),
    });
    expect(rel(root, await expandWorkspacePatterns(root, ['**', '.', '', './']))).toEqual(['packages/a']);
  });

  test('brace expansion and patterns outside the root', async () => {
    const parent = await tree({
      'repo/apps/web/package.json': pkg('web'),
      'repo/apps/api/package.json': pkg('api'),
      'repo/apps/docs/package.json': pkg('docs'),
      'shared/package.json': pkg('shared'),
      'libs/x/package.json': pkg('x'),
    });
    const root = path.join(parent, 'repo');
    const dirs = await expandWorkspacePatterns(root, ['apps/{web,api}', '../shared', '../libs/*']);
    expect(rel(root, dirs)).toEqual(['../libs/x', '../shared', 'apps/api', 'apps/web']);
  });

  test('backslashes are treated as separators', async () => {
    const root = await tree({ 'packages/a/package.json': pkg('a') });
    expect(rel(root, await expandWorkspacePatterns(root, ['packages\\*']))).toEqual(['packages/a']);
  });
});

describe('single-package Bun projects', () => {
  test('a Bun project without workspaces loads as its root package alone', async () => {
    const root = await tree({
      'package.json': { name: 'api', scripts: { dev: 'bun --hot src/index.ts' } },
      'bun.lock': BUN_LOCK,
      'src/index.ts': '',
    });
    const ws = await loadWorkspace(root);
    expect(ws).toMatchObject({ detectedBy: 'bun.lock', patterns: [], packages: [], problems: [] });
    expect(ws?.rootPackage).toMatchObject({
      name: 'api',
      isRoot: true,
      scripts: { dev: 'bun --hot src/index.ts' },
    });
    expect(ws?.catalogs.size).toBe(0);
  });

  test('found from a subfolder of the project', async () => {
    const root = await tree({ 'package.json': { name: 'api' }, 'bunfig.toml': '', 'src/routes/x.ts': '' });
    expect(await findWorkspaceRoots(path.join(root, 'src', 'routes'))).toEqual([root]);
  });

  test('a workspace root above wins over a nested Bun project', async () => {
    const root = await tree({
      ...acmeWorkspace(),
      'packages/core/bunfig.toml': '',
    });
    expect(await findWorkspaceRoots(path.join(root, 'packages', 'core'))).toEqual([root]);
  });

  test('the downward search finds plain Bun projects too, outermost first', async () => {
    const outer = await tree({
      'README.md': '',
      'service/package.json': { name: 'service' },
      'service/bun.lock': BUN_LOCK,
      'service/tools/package.json': { name: 'tools' },
      'service/tools/bun.lock': BUN_LOCK,
      'web/package.json': { name: 'web', packageManager: 'bun@1.4.4' },
      'legacy/package.json': { name: 'legacy' },
    });
    expect(rel(outer, await findWorkspaceRoots(outer))).toEqual(['service', 'web']);
  });
});

describe('loadWorkspace', () => {
  test('loads root, packages, catalogs and detection info', async () => {
    const root = await tree(acmeWorkspace());
    const ws = await loadWorkspace(root);
    expect(ws).toBeDefined();
    if (!ws) return;
    expect(ws.root).toBe(root);
    expect(ws.detectedBy).toBe('bun.lock');
    expect(ws.lockfile).toBe('bun.lock');
    expect(ws.patterns).toEqual(['packages/*', 'apps/*']);
    expect(ws.rootPackage).toMatchObject({
      name: 'acme',
      isRoot: true,
      relativeDir: '',
      scripts: { lint: 'biome check .' },
    });
    expect(ws.packages.map((p) => [p.relativeDir, p.name, p.version ?? null, p.private])).toEqual([
      ['apps/web', 'web', null, true],
      ['packages/core', '@acme/core', '1.2.0', false],
      ['packages/ui', '@acme/ui', '0.3.0', false],
    ]);
    const ui = ws.packages[2];
    expect(ui?.manifestPath).toBe(path.join(root, 'packages', 'ui', 'package.json'));
    expect(ui?.isRoot).toBe(false);
    expect(Object.fromEntries(ws.catalogs.get('default') ?? [])).toEqual({ react: '^19.2.0' });
    expect(Object.fromEntries(ws.catalogs.get('testing') ?? [])).toEqual({ vitest: '^3.2.0' });
    expect(ws.problems).toEqual([]);
  });

  test('bun.lockb and packageManager-only workspaces', async () => {
    const lockb = await tree({ 'package.json': { workspaces: [] }, 'bun.lockb': 'x' });
    expect(await loadWorkspace(lockb)).toMatchObject({ detectedBy: 'bun.lockb', lockfile: 'bun.lockb' });
    const fresh = await tree({ 'package.json': { workspaces: [], packageManager: 'bun@1.4.4' } });
    expect(await loadWorkspace(fresh)).toMatchObject({ detectedBy: 'packageManager', lockfile: undefined });
  });

  test.each([
    ['no package.json', {}],
    ['invalid root manifest', { 'package.json': '{', 'bun.lock': BUN_LOCK }],
    ['a plain npm project', { 'package.json': { name: 'x' }, 'package-lock.json': '{}' }],
    ['not Bun', { 'package.json': { workspaces: ['*'] }, 'yarn.lock': '' }],
  ] as const)('returns undefined: %s', async (_label, spec) => {
    expect(await loadWorkspace(await tree(spec as TreeSpec))).toBeUndefined();
  });

  test('reports invalid manifests, unnamed packages, duplicate names and cycles', async () => {
    const root = await tree({
      'package.json': { name: 'mono', workspaces: ['packages/*'] },
      'bun.lock': BUN_LOCK,
      'packages/broken/package.json': '{ "name": ',
      'packages/unnamed/package.json': { scripts: { build: 'x' } },
      'packages/a/package.json': { name: 'a', dependencies: { b: 'workspace:*' } },
      'packages/b/package.json': { name: 'b', devDependencies: { a: 'workspace:*' } },
      'packages/dup1/package.json': { name: 'dup' },
      'packages/dup2/package.json': { name: 'dup' },
      'packages/rootname/package.json': { name: 'mono' },
    });
    const ws = await loadWorkspace(root);
    expect(ws?.packages.map((p) => p.relativeDir)).toEqual([
      'packages/a',
      'packages/b',
      'packages/dup1',
      'packages/dup2',
      'packages/rootname',
      'packages/unnamed',
    ]);
    const kinds = ws?.problems.map((p) => p.kind).sort();
    expect(kinds).toEqual([
      'dependency-cycle',
      'duplicate-name',
      'duplicate-name',
      'invalid-manifest',
      'unnamed-package',
    ]);
    expect(ws?.problems).toContainEqual({ kind: 'dependency-cycle', packages: ['a', 'b'] });
    expect(ws?.problems).toContainEqual({
      kind: 'unnamed-package',
      manifestPath: path.join(root, 'packages', 'unnamed', 'package.json'),
      relativeDir: 'packages/unnamed',
    });
    expect(ws?.problems).toContainEqual({
      kind: 'duplicate-name',
      name: 'mono',
      manifestPaths: [
        path.join(root, 'package.json'),
        path.join(root, 'packages', 'rootname', 'package.json'),
      ],
    });
    const invalid = ws?.problems.find((p) => p.kind === 'invalid-manifest');
    expect(invalid).toMatchObject({ manifestPath: path.join(root, 'packages', 'broken', 'package.json') });
  });

  test('a matched directory whose package.json disappears is skipped', async () => {
    // A directory symlink loop or race: simulate with a pattern that matches a directory without manifest.
    const root = await tree({
      'package.json': { workspaces: ['packages/*'] },
      'bun.lock': BUN_LOCK,
      'packages/x/a.txt': '',
    });
    expect((await loadWorkspace(root))?.packages).toEqual([]);
  });
});
