import { describe, expect, test } from 'bun:test';
import { WorkspaceGraph } from '../../src/core/graph';
import { type LintIssue, lintManifest } from '../../src/core/lint';
import { byName, makeWorkspace } from '../helpers/model';

const ws = makeWorkspace(
  [
    { dir: 'packages/core', name: '@acme/core' },
    { dir: 'packages/ui', name: '@acme/ui' },
    { dir: 'apps/web', name: 'web' },
    { dir: 'apps/web2', name: 'web' },
  ],
  { catalogs: { default: { react: '^19' }, testing: { vitest: '^3' } } },
);
const graph = new WorkspaceGraph(ws);

function lint(manifest: object, pkgName = '@acme/ui') {
  const text = JSON.stringify(manifest, null, 2);
  const issues = lintManifest(text, byName(ws, pkgName), ws, graph);
  return issues.map((issue: LintIssue) => ({
    ...issue,
    text: text.slice(issue.span.offset, issue.span.offset + issue.span.length),
  }));
}

describe('lintManifest', () => {
  test('a valid manifest has no issues', () => {
    expect(
      lint({
        name: '@acme/ui',
        dependencies: {
          '@acme/core': 'workspace:*',
          core: 'workspace:@acme/core@^',
          web: 'workspace:../../apps/web',
          react: 'catalog:',
          lodash: '^4',
        },
        devDependencies: { vitest: 'catalog:testing', 'react-dom': 'npm:react-dom@19' },
      }),
    ).toEqual([]);
  });

  test('workspace: on an unknown package, with suggestions, on the key', () => {
    const [issue] = lint({ dependencies: { '@acme/cor': 'workspace:*' } });
    expect(issue).toMatchObject({
      code: 'unknown-workspace-package',
      name: '@acme/cor',
      suggestions: ['@acme/core'],
      text: '@acme/cor',
    });
  });

  test('workspace alias to an unknown package points at the value', () => {
    const [issue] = lint({ dependencies: { core: 'workspace:@acme/kore@*' } });
    expect(issue).toMatchObject({
      code: 'unknown-workspace-package',
      name: '@acme/kore',
      text: 'workspace:@acme/kore@*',
    });
  });

  test('workspace path that is not a package', () => {
    const [issue] = lint({ dependencies: { x: 'workspace:../nowhere' } });
    expect(issue).toMatchObject({
      code: 'unknown-workspace-path',
      path: '../nowhere',
      text: 'workspace:../nowhere',
    });
  });

  test('catalog references', () => {
    const issues = lint({
      dependencies: { zod: 'catalog:', vite: 'catalog:testing' },
      devDependencies: { vitest: 'catalog:testin', jest: 'catalog:nope' },
    });
    expect(issues.map(({ code, text, ...rest }) => ({ code, text, rest }))).toEqual([
      {
        code: 'missing-catalog-entry',
        text: 'catalog:',
        rest: expect.objectContaining({ catalog: 'default', dependency: 'zod' }),
      },
      {
        code: 'missing-catalog-entry',
        text: 'catalog:testing',
        rest: expect.objectContaining({ catalog: 'testing', dependency: 'vite' }),
      },
      {
        code: 'unknown-catalog',
        text: 'catalog:testin',
        rest: expect.objectContaining({ catalog: 'testin', suggestions: ['testing'] }),
      },
      {
        code: 'unknown-catalog',
        text: 'catalog:nope',
        rest: expect.objectContaining({ catalog: 'nope', suggestions: [] }),
      },
    ]);
  });

  test('catalog: without any default catalog is a missing entry, not an unknown catalog', () => {
    const noCatalogs = makeWorkspace([{ dir: 'a', name: 'a' }]);
    const text = '{"dependencies": {"react": "catalog:"}}';
    const issues = lintManifest(text, byName(noCatalogs, 'a'), noCatalogs, new WorkspaceGraph(noCatalogs));
    expect(issues).toEqual([
      { code: 'missing-catalog-entry', span: expect.any(Object), catalog: 'default', dependency: 'react' },
    ]);
  });

  test('duplicate package names are flagged on the name value', () => {
    const [issue] = lint({ name: 'web' }, 'web');
    expect(issue).toMatchObject({
      code: 'duplicate-package-name',
      name: 'web',
      others: ['apps/web2'],
      text: 'web',
    });
  });

  test('duplicate check needs a name node in the text', () => {
    expect(lint({ version: '1.0.0' }, 'web')).toEqual([]);
  });

  test('the root package can be linted too', () => {
    const text = '{"devDependencies": {"web": "workspace:*", "ghost": "workspace:*"}}';
    expect(lintManifest(text, ws.rootPackage, ws, graph).map((i) => i.code)).toEqual([
      'unknown-workspace-package',
    ]);
  });

  test('unnamed packages skip the duplicate-name check', () => {
    const unnamed = makeWorkspace([{ dir: 'x' }]);
    const pkg = unnamed.packages[0];
    if (!pkg) throw new Error('fixture');
    expect(lintManifest('{"name": "root"}', pkg, unnamed, new WorkspaceGraph(unnamed))).toEqual([]);
  });
});

describe('lintManifest: root-only checks', () => {
  test('catalog: in root overrides is checked; in other packages overrides are ignored', () => {
    const text = '{"overrides": {"react": "catalog:", "zod": "catalog:", "vitest": "catalog:nope"}}';
    expect(lintManifest(text, ws.rootPackage, ws, graph).map((i) => i.code)).toEqual([
      'missing-catalog-entry',
      'unknown-catalog',
    ]);
    expect(lintManifest(text, byName(ws, '@acme/ui'), ws, graph)).toEqual([]);
  });

  test('workspace: specs in overrides are not treated as workspace dependencies', () => {
    expect(lintManifest('{"overrides": {"ghost": "workspace:*"}}', ws.rootPackage, ws, graph)).toEqual([]);
  });

  test('a package in both catalog and catalogs.default is an error at the catalogs.default key', () => {
    const text = '{"catalog": {"react": "^19"}, "catalogs": {"default": {"react": "^18"}}}';
    const [issue] = lintManifest(text, ws.rootPackage, ws, graph);
    expect(issue).toMatchObject({ code: 'catalog-default-conflict', dependency: 'react' });
    expect(issue && text.slice(issue.span.offset, issue.span.offset + issue.span.length)).toBe('react');
    expect(lintManifest(text, byName(ws, '@acme/ui'), ws, graph)).toEqual([]);
  });
});
