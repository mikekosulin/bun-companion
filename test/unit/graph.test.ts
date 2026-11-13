import { describe, expect, test } from 'bun:test';
import { findCycles, parseWorkspaceSpec, WorkspaceGraph } from '../../src/core/graph';
import type { WorkspacePackage } from '../../src/core/types';
import { byName, makeWorkspace } from '../helpers/model';

const names = (pkgs: WorkspacePackage[]) => pkgs.map((p) => p.name ?? p.relativeDir);

describe('parseWorkspaceSpec', () => {
  test.each([
    ['workspace:*', { kind: 'range', range: '*' }],
    ['workspace:^', { kind: 'range', range: '^' }],
    ['workspace:~', { kind: 'range', range: '~' }],
    ['workspace:', { kind: 'range', range: '*' }],
    ['workspace:1.0.2', { kind: 'range', range: '1.0.2' }],
    ['workspace:^1.0.0', { kind: 'range', range: '^1.0.0' }],
    ['workspace:>=1', { kind: 'range', range: '>=1' }],
    ['workspace:latest', { kind: 'range', range: 'latest' }],
    ['workspace:../pkg-b', { kind: 'path', path: '../pkg-b' }],
    ['workspace:./b', { kind: 'path', path: './b' }],
    ['workspace:/abs/b', { kind: 'path', path: '/abs/b' }],
    ['workspace:pkg-b@^', { kind: 'alias', name: 'pkg-b', range: '^' }],
    ['workspace:pkg-b@', { kind: 'alias', name: 'pkg-b', range: '*' }],
    ['workspace:@scope/b@*', { kind: 'alias', name: '@scope/b', range: '*' }],
    ['workspace:@scope/b', { kind: 'alias', name: '@scope/b', range: '*' }],
  ])('%p', (spec, expected) => {
    expect(parseWorkspaceSpec(spec)).toEqual(expected as ReturnType<typeof parseWorkspaceSpec>);
  });

  test('non-workspace specs', () => {
    expect(parseWorkspaceSpec('^1.0.0')).toBeUndefined();
    expect(parseWorkspaceSpec('catalog:')).toBeUndefined();
  });
});

describe('WorkspaceGraph', () => {
  const ws = makeWorkspace(
    [
      { dir: 'packages/core', name: '@acme/core' },
      { dir: 'packages/utils', name: '@acme/utils', deps: { dependencies: { '@acme/core': 'workspace:*' } } },
      {
        dir: 'packages/ui',
        name: '@acme/ui',
        deps: {
          dependencies: { '@acme/utils': 'workspace:^' },
          peerDependencies: { '@acme/theme': 'workspace:*' },
        },
      },
      { dir: 'packages/theme', name: '@acme/theme' },
      {
        dir: 'apps/web',
        name: 'web',
        deps: {
          dependencies: { '@acme/ui': '^0.3.0', ui: 'workspace:@acme/ui@*', react: '^19' },
          devDependencies: { tools: 'workspace:../../tools' },
          optionalDependencies: { '@acme/core': 'npm:@acme/core@1' },
        },
      },
      { dir: 'tools', name: undefined },
    ],
    { root: { deps: { devDependencies: { web: 'workspace:*' } } } },
  );
  const graph = new WorkspaceGraph(ws);

  test('edges cover workspace:, aliases, paths and plain names; skip npm: aliases and externals', () => {
    const edges = graph.edges.map(
      (e) => `${e.from.name ?? '.'} -> ${e.to.name ?? e.to.relativeDir} [${e.via}]`,
    );
    expect(edges.sort()).toEqual([
      '@acme/ui -> @acme/theme [workspace]',
      '@acme/ui -> @acme/utils [workspace]',
      '@acme/utils -> @acme/core [workspace]',
      'root -> web [workspace]',
      'web -> @acme/ui [name]',
      'web -> @acme/ui [workspace]',
      'web -> tools [workspace]',
    ]);
  });

  test.each([
    ['file:../x'],
    ['link:../x'],
    ['github:acme/core'],
    ['git+https://github.com/acme/core.git'],
    ['https://example.com/core.tgz'],
  ])('a %p spec never resolves to a workspace package', (spec) => {
    const from = byName(ws, 'web');
    expect(graph.resolve(from, { name: '@acme/core', spec, field: 'dependencies' })).toBeUndefined();
  });

  test('packageByName', () => {
    expect(graph.packageByName('@acme/ui')?.relativeDir).toBe('packages/ui');
    expect(graph.packageByName('nope')).toBeUndefined();
  });

  test('direct dependencies and dependents; peers only on request', () => {
    const ui = byName(ws, '@acme/ui');
    expect(names(graph.dependenciesOf(ui))).toEqual(['@acme/utils']);
    expect(names(graph.dependenciesOf(ui, true))).toEqual(['@acme/theme', '@acme/utils']);
    expect(names(graph.dependentsOf(ui))).toEqual(['web']);
    expect(names(graph.dependentsOf(byName(ws, '@acme/theme')))).toEqual([]);
    expect(names(graph.dependentsOf(byName(ws, '@acme/theme'), true))).toEqual(['@acme/ui']);
  });

  test('closure follows the graph transitively without including the package itself', () => {
    expect(names(graph.closure(byName(ws, 'web'), 'dependencies'))).toEqual([
      '@acme/core',
      '@acme/ui',
      '@acme/utils',
      'tools',
    ]);
    // sorted by directory: '' (root), apps/web, packages/ui, packages/utils
    expect(names(graph.closure(byName(ws, '@acme/core'), 'dependents'))).toEqual([
      'root',
      'web',
      '@acme/ui',
      '@acme/utils',
    ]);
  });

  test('self-dependencies are ignored', () => {
    const selfWs = makeWorkspace([{ dir: 'a', name: 'a', deps: { dependencies: { a: 'workspace:*' } } }]);
    expect(new WorkspaceGraph(selfWs).edges).toEqual([]);
  });

  test('first package wins when names are duplicated (root first, then by directory)', () => {
    const dup = makeWorkspace([
      { dir: 'b', name: 'x' },
      { dir: 'a', name: 'x' },
    ]);
    expect(new WorkspaceGraph(dup).packageByName('x')?.relativeDir).toBe('a');
    const rootDup = makeWorkspace([{ dir: 'a', name: 'x' }], { root: { name: 'x' } });
    expect(new WorkspaceGraph(rootDup).packageByName('x')?.relativeDir).toBe('');
  });
});

describe('findCycles', () => {
  test('no cycles in a DAG', () => {
    const ws = makeWorkspace([
      { dir: 'a', name: 'a', deps: { dependencies: { b: 'workspace:*' } } },
      { dir: 'b', name: 'b' },
    ]);
    expect(findCycles(ws)).toEqual([]);
  });

  test('reports each strongly connected component once, ignoring peer edges', () => {
    const ws = makeWorkspace([
      { dir: 'a', name: 'a', deps: { dependencies: { b: 'workspace:*' } } },
      { dir: 'b', name: 'b', deps: { devDependencies: { c: 'workspace:*' } } },
      { dir: 'c', name: 'c', deps: { optionalDependencies: { a: 'workspace:*' } } },
      { dir: 'x', name: 'x', deps: { dependencies: { y: 'workspace:*' } } },
      { dir: 'y', name: 'y', deps: { dependencies: { x: '^1' } } },
      { dir: 'p', name: 'p', deps: { peerDependencies: { q: 'workspace:*' } } },
      { dir: 'q', name: 'q', deps: { dependencies: { p: 'workspace:*' } } },
      { dir: 'u', deps: { dependencies: { v: 'workspace:*' } } },
      { dir: 'v', name: 'v', deps: { dependencies: { u: 'workspace:../u' } } },
    ]);
    expect(findCycles(ws)).toEqual([
      ['a', 'b', 'c'],
      ['u', 'v'],
      ['x', 'y'],
    ]);
  });
});
