import { describe, expect, test } from 'bun:test';
import {
  catalogNameFromSpec,
  type Manifest,
  parseManifest,
  readWorkspacesConfig,
} from '../../src/core/manifest';

function manifest(value: unknown): Manifest {
  const result = parseManifest(JSON.stringify(value));
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}

function catalogsAsObject(m: Manifest): Record<string, Record<string, string>> | undefined {
  const config = readWorkspacesConfig(m);
  if (!config) return undefined;
  return Object.fromEntries([...config.catalogs].map(([k, v]) => [k, Object.fromEntries(v)]));
}

describe('parseManifest', () => {
  test('reads name, version, private, packageManager, scripts and all dependency fields', () => {
    const m = manifest({
      name: '@acme/ui',
      version: '1.0.0',
      private: true,
      packageManager: 'bun@1.4.2',
      scripts: { build: 'tsc', bad: 42 },
      dependencies: { a: '^1' },
      devDependencies: { b: '^2' },
      optionalDependencies: { c: '^3' },
      peerDependencies: { d: '^4' },
    });
    expect(m.name).toBe('@acme/ui');
    expect(m.version).toBe('1.0.0');
    expect(m.private).toBe(true);
    expect(m.packageManager).toBe('bun@1.4.2');
    expect(m.scripts).toEqual({ build: 'tsc' });
    expect(m.dependencies).toEqual([
      { name: 'a', spec: '^1', field: 'dependencies' },
      { name: 'b', spec: '^2', field: 'devDependencies' },
      { name: 'c', spec: '^3', field: 'optionalDependencies' },
      { name: 'd', spec: '^4', field: 'peerDependencies' },
    ]);
  });

  test('treats missing, empty and non-string fields as absent', () => {
    const m = manifest({ name: '  ', version: 1, private: 'yes', scripts: [], dependencies: null });
    expect(m.name).toBeUndefined();
    expect(m.version).toBeUndefined();
    expect(m.private).toBe(false);
    expect(m.scripts).toEqual({});
    expect(m.dependencies).toEqual([]);
  });

  test('accepts comments and trailing commas like Bun does', () => {
    const result = parseManifest('{\n  // comment\n  "name": "x",\n}');
    expect(result.ok && result.manifest.name).toBe('x');
  });

  test('reports syntax errors with an offset', () => {
    const result = parseManifest('{ "name": ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at offset \d+/);
  });

  test.each(['[]', '"str"', '42', 'null'])('rejects non-object JSON %p', (text) => {
    expect(parseManifest(text)).toEqual({ ok: false, error: 'package.json must contain a JSON object' });
  });
});

describe('readWorkspacesConfig', () => {
  test('returns undefined without a workspaces field', () => {
    expect(readWorkspacesConfig(manifest({ name: 'x' }))).toBeUndefined();
    expect(readWorkspacesConfig(manifest({ workspaces: 'packages/*' }))).toBeUndefined();
  });

  test('array form keeps only strings, in order', () => {
    const config = readWorkspacesConfig(manifest({ workspaces: ['packages/*', 3, '!packages/x'] }));
    expect(config?.patterns).toEqual(['packages/*', '!packages/x']);
    expect(config?.catalogs.size).toBe(0);
  });

  test('object form reads packages; a missing packages list means no patterns', () => {
    expect(readWorkspacesConfig(manifest({ workspaces: { packages: ['apps/*'] } }))?.patterns).toEqual([
      'apps/*',
    ]);
    expect(readWorkspacesConfig(manifest({ workspaces: { nohoist: [] } }))?.patterns).toEqual([]);
  });

  test('catalogs under workspaces', () => {
    const m = manifest({
      workspaces: { packages: [], catalog: { react: '^19' }, catalogs: { testing: { vitest: '^3' } } },
    });
    expect(catalogsAsObject(m)).toEqual({ default: { react: '^19' }, testing: { vitest: '^3' } });
  });

  test('top-level catalogs (Bun ≥ 1.2.19)', () => {
    const m = manifest({
      workspaces: ['a/*'],
      catalog: { react: '^19' },
      catalogs: { build: { tsup: '^8' } },
    });
    expect(catalogsAsObject(m)).toEqual({ default: { react: '^19' }, build: { tsup: '^8' } });
  });

  test('catalogs.default merges into the default catalog; workspaces wins on conflicts', () => {
    const m = manifest({
      catalog: { react: '^18', zod: '^4' },
      catalogs: { default: { vite: '^8' } },
      workspaces: { packages: [], catalog: { react: '^19' } },
    });
    expect(catalogsAsObject(m)).toEqual({ default: { react: '^19', zod: '^4', vite: '^8' } });
  });

  test('an empty catalog object is still a defined catalog', () => {
    const m = manifest({ workspaces: { packages: [], catalogs: { empty: {} } } });
    expect(catalogsAsObject(m)).toEqual({ empty: {} });
  });

  test('ignores malformed catalogs', () => {
    const m = manifest({ workspaces: { packages: [], catalog: 'x', catalogs: ['y'] } });
    expect(catalogsAsObject(m)).toEqual({});
  });
});

describe('catalogNameFromSpec', () => {
  test.each([
    ['catalog:', 'default'],
    ['catalog:default', 'default'],
    ['catalog:testing', 'testing'],
    ['catalog: build ', 'build'],
    ['^1.0.0', undefined],
    ['workspace:*', undefined],
  ])('%p -> %p', (spec, expected) => {
    expect(catalogNameFromSpec(spec)).toBe(expected as string | undefined);
  });
});
