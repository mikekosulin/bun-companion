import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import {
  buildCopyableCommand,
  buildRunInvocation,
  formatCommandLine,
  quoteArg,
  type RunTarget,
  scriptsAcrossPackages,
  selectorFor,
} from '../../src/core/commands';
import { WorkspaceGraph } from '../../src/core/graph';
import { parseVersion } from '../../src/core/version';
import { byName, makeWorkspace, ROOT } from '../helpers/model';

const ws = makeWorkspace(
  [
    { dir: 'packages/core', name: '@acme/core', scripts: { build: 'tsc', test: 'bun test' } },
    {
      dir: 'packages/ui',
      name: '@acme/ui',
      scripts: { build: 'tsc' },
      deps: { dependencies: { '@acme/core': 'workspace:*' } },
    },
    {
      dir: 'apps/web',
      name: 'web',
      scripts: { build: 'vite build', dev: 'vite' },
      deps: { dependencies: { '@acme/ui': 'workspace:*' } },
    },
    {
      dir: 'tools/gen',
      scripts: { build: 'node gen.js' },
      deps: { dependencies: { '@acme/core': 'workspace:*' } },
    },
  ],
  { root: { scripts: { lint: 'biome check .' } } },
);
const graph = new WorkspaceGraph(ws);
const v14 = parseVersion('1.4.2');
const v13 = parseVersion('1.3.9');

function run(target: RunTarget, script: string, version = v14) {
  return buildRunInvocation(ws, graph, target, script, version);
}

describe('selectorFor', () => {
  test('name for named packages, ./path for unnamed ones', () => {
    expect(selectorFor(byName(ws, '@acme/ui'))).toBe('@acme/ui');
    expect(selectorFor(ws.packages.find((p) => p.name === undefined) as never)).toBe('./tools/gen');
  });
});

describe('buildRunInvocation', () => {
  test('single package runs in its own directory without --filter', () => {
    expect(run({ kind: 'package', pkg: byName(ws, '@acme/ui') }, 'build')).toEqual({
      cwd: path.join(ROOT, 'packages', 'ui'),
      args: ['run', 'build'],
      label: '@acme/ui › build',
      filters: [],
    });
  });

  test('root package runs at the root', () => {
    expect(run({ kind: 'package', pkg: ws.rootPackage }, 'lint')).toMatchObject({
      cwd: ROOT,
      args: ['run', 'lint'],
      label: 'root › lint',
    });
  });

  test('graph selectors on Bun ≥ 1.4', () => {
    const web = byName(ws, 'web');
    expect(run({ kind: 'withDependencies', pkg: web }, 'build')).toEqual({
      cwd: ROOT,
      args: ['run', '--filter', 'web...', 'build'],
      label: 'web... › build',
      filters: ['web...'],
    });
    expect(run({ kind: 'dependents', pkg: byName(ws, '@acme/core') }, 'build')).toEqual({
      cwd: ROOT,
      args: ['run', '--filter', '...@acme/core', 'build'],
      label: '...@acme/core › build',
      filters: ['...@acme/core'],
    });
  });

  test('explicit package lists on older Bun or when Bun version is unknown', () => {
    const web = byName(ws, 'web');
    for (const version of [v13, undefined]) {
      expect(
        buildRunInvocation(ws, graph, { kind: 'withDependencies', pkg: web }, 'build', version).args,
      ).toEqual(['run', '--filter', 'web', '--filter', '@acme/core', '--filter', '@acme/ui', 'build']);
    }
    expect(run({ kind: 'dependents', pkg: byName(ws, '@acme/core') }, 'build', v13).filters).toEqual([
      '@acme/core',
      'web',
      '@acme/ui',
      './tools/gen',
    ]);
  });

  test('unnamed packages always get explicit path selectors', () => {
    const gen = ws.packages.find((p) => p.name === undefined);
    if (!gen) throw new Error('fixture');
    expect(run({ kind: 'withDependencies', pkg: gen }, 'build').filters).toEqual([
      './tools/gen',
      '@acme/core',
    ]);
  });

  test('the root package is never passed to --filter', () => {
    const rootDepWs = makeWorkspace([{ dir: 'a', name: 'a', scripts: { build: 'x' } }], {
      root: { deps: { dependencies: { a: 'workspace:*' } } },
    });
    const g = new WorkspaceGraph(rootDepWs);
    const inv = buildRunInvocation(
      rootDepWs,
      g,
      { kind: 'dependents', pkg: byName(rootDepWs, 'a') },
      'build',
      v13,
    );
    expect(inv.filters).toEqual(['a']);
  });

  test('all packages: * when every package with the script is named, else explicit', () => {
    expect(run({ kind: 'all' }, 'dev')).toEqual({
      cwd: ROOT,
      args: ['run', '--filter', '*', 'dev'],
      label: '* › dev',
      filters: ['*'],
    });
    expect(run({ kind: 'all' }, 'build').filters).toEqual(['web', '@acme/core', '@acme/ui', './tools/gen']);
  });
});

describe('buildCopyableCommand', () => {
  test('filter runs are copied as is', () => {
    const inv = run({ kind: 'withDependencies', pkg: byName(ws, 'web') }, 'build');
    expect(buildCopyableCommand(inv, 'darwin')).toBe('bun run --filter web... build');
    expect(buildCopyableCommand(run({ kind: 'all' }, 'dev'), 'linux')).toBe("bun run --filter '*' dev");
  });

  test('named package -> --filter <name> so it works from the root', () => {
    const ui = byName(ws, '@acme/ui');
    expect(buildCopyableCommand(run({ kind: 'package', pkg: ui }, 'build'), 'darwin', ui)).toBe(
      'bun run --filter @acme/ui build',
    );
  });

  test('root and unnamed packages', () => {
    expect(
      buildCopyableCommand(run({ kind: 'package', pkg: ws.rootPackage }, 'lint'), 'darwin', ws.rootPackage),
    ).toBe('bun run lint');
    const gen = ws.packages.find((p) => p.name === undefined);
    if (!gen) throw new Error('fixture');
    expect(buildCopyableCommand(run({ kind: 'package', pkg: gen }, 'build'), 'darwin', gen)).toBe(
      'cd tools/gen && bun run build',
    );
    expect(buildCopyableCommand(run({ kind: 'package', pkg: gen }, 'build'), 'darwin')).toBe('bun run build');
  });
});

describe('quoting', () => {
  test.each([
    ['build', 'build', 'build'],
    ['@acme/ui', '@acme/ui', '@acme/ui'],
    ['web...', 'web...', 'web...'],
    ['*', "'*'", '"*"'],
    ['build:watch', 'build:watch', 'build:watch'],
    ['has space', "'has space'", '"has space"'],
    ["it's", "'it'\\''s'", '"it\'s"'],
    ['say "hi"', `'say "hi"'`, '"say \\"hi\\""'],
    ['', "''", '""'],
    ['C:\\bun\\bun.exe', "'C:\\bun\\bun.exe'", 'C:\\bun\\bun.exe'],
  ])('%p', (arg, posix, windows) => {
    expect(quoteArg(arg, 'darwin')).toBe(posix);
    expect(quoteArg(arg, 'win32')).toBe(windows);
  });

  test('formatCommandLine', () => {
    expect(formatCommandLine(['bun', 'run', '--filter', '*', 'my script'], 'linux')).toBe(
      "bun run --filter '*' 'my script'",
    );
  });
});

describe('scriptsAcrossPackages', () => {
  test('groups script names (sorted) to the packages that define them; root excluded', () => {
    const grouped = scriptsAcrossPackages(ws);
    expect([...grouped.keys()]).toEqual(['build', 'dev', 'test']);
    expect(grouped.get('build')?.map((p) => p.relativeDir)).toEqual([
      'apps/web',
      'packages/core',
      'packages/ui',
      'tools/gen',
    ]);
    expect(grouped.has('lint')).toBe(false);
  });
});
