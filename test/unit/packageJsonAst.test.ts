import { describe, expect, test } from 'bun:test';
import {
  findCatalogDefaultConflicts,
  findCatalogEntry,
  findDependencyNodes,
  findNameNode,
  findOverrideNodes,
  findScriptNodes,
  findSpecNodes,
  getCompletionContext,
  overrideTarget,
  type Span,
  spanContains,
} from '../../src/core/packageJsonAst';

const text = `{
  "name": "@acme/web",
  // Bun allows comments
  "scripts": { "dev": "vite", "build": "vite build", },
  "dependencies": { "@acme/ui": "workspace:*", "react": "catalog:", "bad": 1 },
  "devDependencies": { "vitest": "catalog:testing" },
  "peerDependencies": {},
  "optionalDependencies": []
}`;

const at = (span: Span | undefined) =>
  span ? text.slice(span.offset, span.offset + span.length) : undefined;

describe('findDependencyNodes', () => {
  test('returns name, spec, field and exact spans (without quotes)', () => {
    const deps = findDependencyNodes(text);
    expect(deps.map((d) => [d.field, d.name, d.spec, at(d.key), at(d.value)])).toEqual([
      ['dependencies', '@acme/ui', 'workspace:*', '@acme/ui', 'workspace:*'],
      ['dependencies', 'react', 'catalog:', 'react', 'catalog:'],
      ['devDependencies', 'vitest', 'catalog:testing', 'vitest', 'catalog:testing'],
    ]);
  });

  test('tolerates broken documents', () => {
    expect(findDependencyNodes('')).toEqual([]);
    expect(findDependencyNodes('{ "dependencies": { "a": "^1", ')).toEqual([
      expect.objectContaining({ name: 'a', spec: '^1' }),
    ]);
  });
});

describe('findScriptNodes / findNameNode', () => {
  test('scripts with key and value spans', () => {
    expect(findScriptNodes(text).map((s) => [s.name, at(s.key), at(s.value)])).toEqual([
      ['dev', 'dev', 'vite'],
      ['build', 'build', 'vite build'],
    ]);
    expect(findScriptNodes('{}')).toEqual([]);
    expect(findScriptNodes('')).toEqual([]);
    expect(findScriptNodes('{"scripts": []}')).toEqual([]);
    const numeric = '{"scripts": {"n": 42}}';
    const [n] = findScriptNodes(numeric);
    expect(n && numeric.slice(n.value.offset, n.value.offset + n.value.length)).toBe('42');
  });

  test('name', () => {
    expect(at(findNameNode(text))).toBe('@acme/web');
    expect(findNameNode('{"name": 1}')).toBeUndefined();
    expect(findNameNode('')).toBeUndefined();
  });
});

describe('findCatalogEntry', () => {
  const root = `{
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": { "react": "^19.2.0" },
    "catalogs": { "testing": { "vitest": "^3.2.0" } }
  },
  "catalog": { "react": "^18.0.0", "zod": "^4.1.0" },
  "catalogs": { "default": { "vite": "^8.0.0" }, "build": { "tsup": "^8.0.0" } }
}`;
  const entry = (catalog: string, dep: string) => {
    const found = findCatalogEntry(root, catalog, dep);
    return found
      ? [
          root.slice(found.key.offset, found.key.offset + found.key.length),
          root.slice(found.value.offset, found.value.offset + found.value.length),
        ]
      : undefined;
  };

  test('prefers workspaces.catalog over top-level, and finds catalogs.default', () => {
    expect(entry('default', 'react')).toEqual(['react', '^19.2.0']);
    expect(entry('default', 'zod')).toEqual(['zod', '^4.1.0']);
    expect(entry('default', 'vite')).toEqual(['vite', '^8.0.0']);
  });

  test('named catalogs in both locations', () => {
    expect(entry('testing', 'vitest')).toEqual(['vitest', '^3.2.0']);
    expect(entry('build', 'tsup')).toEqual(['tsup', '^8.0.0']);
  });

  test('missing entries and documents', () => {
    expect(entry('testing', 'react')).toBeUndefined();
    expect(entry('nope', 'react')).toBeUndefined();
    expect(findCatalogEntry('', 'default', 'react')).toBeUndefined();
  });
});

describe('getCompletionContext', () => {
  const doc = '{\n  "dependencies": {\n    "@acme/u": "work"\n  },\n  "scripts": { "a": "b" }\n}';
  const offsetOf = (needle: string, delta = 0) => doc.indexOf(needle) + delta;

  test('inside a dependency value', () => {
    const ctx = getCompletionContext(doc, offsetOf('"work"', 3));
    expect(ctx).toEqual({
      kind: 'dependencyValue',
      field: 'dependencies',
      dependency: '@acme/u',
      span: { offset: offsetOf('"work"', 1), length: 4 },
      prefix: 'wo',
    });
  });

  test('inside a dependency key', () => {
    const ctx = getCompletionContext(doc, offsetOf('"@acme/u"', 4));
    expect(ctx).toMatchObject({ kind: 'dependencyKey', field: 'dependencies', prefix: '@ac' });
    expect(ctx?.span).toEqual({ offset: offsetOf('"@acme/u"', 1), length: 7 });
  });

  test('a fresh property position inside a dependency object', () => {
    const fresh = '{ "devDependencies": {  } }';
    const ctx = getCompletionContext(fresh, fresh.indexOf('{  }') + 2);
    expect(ctx).toMatchObject({ kind: 'dependencyKey', field: 'devDependencies', prefix: '' });
    expect(ctx?.span.length).toBe(0);
  });

  test('outside dependency objects', () => {
    expect(getCompletionContext(doc, offsetOf('"b"', 1))).toBeUndefined();
    expect(getCompletionContext(doc, 0)).toBeUndefined();
    expect(getCompletionContext('{ "dependencies": { "a": { "b": "" } } }', 30)).toBeUndefined();
  });

  test('spanContains is inclusive at both ends', () => {
    expect(spanContains({ offset: 5, length: 3 }, 5)).toBe(true);
    expect(spanContains({ offset: 5, length: 3 }, 8)).toBe(true);
    expect(spanContains({ offset: 5, length: 3 }, 9)).toBe(false);
    expect(spanContains({ offset: 5, length: 3 }, 4)).toBe(false);
  });
});

describe('overrides', () => {
  const doc = `{
  "overrides": {
    "react": "catalog:",
    "vite@^7": "catalog:build",
    "@scope/pkg": { ".": "catalog:", "lodash": "catalog:" },
    "ignored": 42
  }
}`;
  const slice = (span: Span) => doc.slice(span.offset, span.offset + span.length);

  test('findOverrideNodes walks nested overrides and resolves the target package', () => {
    expect(
      findOverrideNodes(doc).map((n) => [n.name, n.spec, slice(n.key), slice(n.value), n.field]),
    ).toEqual([
      ['react', 'catalog:', 'react', 'catalog:', 'overrides'],
      ['vite', 'catalog:build', 'vite@^7', 'catalog:build', 'overrides'],
      ['@scope/pkg', 'catalog:', '.', 'catalog:', 'overrides'],
      ['lodash', 'catalog:', 'lodash', 'catalog:', 'overrides'],
    ]);
    expect(findOverrideNodes('{}')).toEqual([]);
    expect(findOverrideNodes('')).toEqual([]);
  });

  test('overrideTarget', () => {
    expect(overrideTarget(['@scope/pkg@1.x'])).toBe('@scope/pkg');
    expect(overrideTarget(['a', '.'])).toBe('a');
    expect(overrideTarget([])).toBeUndefined();
  });

  test('findSpecNodes = dependencies + overrides', () => {
    const text = '{"dependencies": {"a": "^1"}, "overrides": {"b": "catalog:"}}';
    expect(findSpecNodes(text).map((n) => `${n.field}:${n.name}`)).toEqual(['dependencies:a', 'overrides:b']);
  });

  test('completion inside an override value, not inside its key', () => {
    const at = doc.indexOf('"catalog:build"') + 3;
    expect(getCompletionContext(doc, at)).toMatchObject({
      kind: 'dependencyValue',
      field: 'overrides',
      dependency: 'vite',
    });
    const nested = doc.indexOf('"lodash": "catalog:"') + 12;
    expect(getCompletionContext(doc, nested)).toMatchObject({ field: 'overrides', dependency: 'lodash' });
    expect(getCompletionContext(doc, doc.indexOf('"react"') + 2)).toBeUndefined();
    expect(getCompletionContext('{"overrides": {".": ""}}', 19)).toBeUndefined();
  });
});

describe('findCatalogDefaultConflicts', () => {
  test('entries in catalogs.default that are also in catalog, in any location', () => {
    const text = JSON.stringify({
      catalog: { react: '^19' },
      workspaces: { catalog: { zod: '^4' }, catalogs: { default: { zod: '^3' } } },
      catalogs: { default: { react: '^18', vite: '^8' } },
    });
    expect(findCatalogDefaultConflicts(text).map((c) => c.name)).toEqual(['react', 'zod']);
    expect(findCatalogDefaultConflicts('')).toEqual([]);
  });
});
