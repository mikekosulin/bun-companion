import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { isInside, normalizePattern, toPosixRelative } from '../../src/core/paths';
import { closestMatches, editDistance } from '../../src/core/strings';
import { allPackages, packageLabel } from '../../src/core/types';
import { atLeast, BUN_FEATURES, compareVersions, formatVersion, parseVersion } from '../../src/core/version';
import { makeWorkspace } from '../helpers/model';

describe('version', () => {
  test.each([
    ['1.4.2', { major: 1, minor: 4, patch: 2 }],
    ['1.4.2+50a8a8387', { major: 1, minor: 4, patch: 2 }],
    [' v1.3.0-canary.12\n', { major: 1, minor: 3, patch: 0 }],
    ['10.20.30', { major: 10, minor: 20, patch: 30 }],
    ['1.4', undefined],
    ['bun', undefined],
  ])('parseVersion(%p)', (text, expected) => {
    expect(parseVersion(text)).toEqual(expected as never);
  });

  test('compare, atLeast, format', () => {
    const v = (s: string) => parseVersion(s) as NonNullable<ReturnType<typeof parseVersion>>;
    expect(compareVersions(v('1.4.0'), v('1.3.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.4.0'), v('1.4.0'))).toBe(0);
    expect(compareVersions(v('1.10.0'), v('1.9.0'))).toBeGreaterThan(0);
    expect(atLeast(v('1.4.0'), BUN_FEATURES.graphFilters)).toBe(true);
    expect(atLeast(v('1.3.9'), BUN_FEATURES.graphFilters)).toBe(false);
    expect(atLeast(undefined, '1.0.0')).toBe(false);
    expect(atLeast(v('1.0.0'), 'garbage')).toBe(false);
    expect(formatVersion(v('1.4.2+abc'))).toBe('1.4.2');
  });
});

describe('paths', () => {
  const root = path.resolve('/repo');
  test('toPosixRelative', () => {
    expect(toPosixRelative(root, path.join(root, 'packages', 'ui'))).toBe('packages/ui');
    expect(toPosixRelative(root, root)).toBe('');
  });

  test('isInside', () => {
    expect(isInside(root, root)).toBe(true);
    expect(isInside(root, path.join(root, 'a', 'b'))).toBe(true);
    expect(isInside(root, path.join(root, '..foo'))).toBe(true);
    expect(isInside(root, path.resolve('/repo-other'))).toBe(false);
    expect(isInside(root, path.resolve('/'))).toBe(false);
  });

  test.each([
    ['./packages/*/', 'packages/*'],
    ['././a', 'a'],
    [' packages\\* ', 'packages/*'],
    ['/', '/'],
    ['.', '.'],
  ])('normalizePattern(%p) = %p', (input, expected) => {
    expect(normalizePattern(input)).toBe(expected);
  });
});

describe('strings', () => {
  test('editDistance', () => {
    expect(editDistance('', '')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });

  test('closestMatches suggests typo fixes, best first, scaled by length', () => {
    const names = ['@acme/ui', '@acme/utils', '@acme/core', 'web', 'api'];
    expect(closestMatches('@acme/uii', names)).toEqual(['@acme/ui']);
    expect(closestMatches('@acme/util', names)).toEqual(['@acme/utils', '@acme/ui']);
    expect(closestMatches('@ACME/CORE', names)).toEqual(['@acme/core']);
    expect(closestMatches('wbe', names)).toEqual([]);
    expect(closestMatches('we', names)).toEqual(['web']);
    expect(closestMatches('web', names)).toEqual([]);
    expect(closestMatches('@acme/u', names, 1)).toEqual(['@acme/ui']);
  });
});

describe('types helpers', () => {
  test('packageLabel and allPackages', () => {
    const ws = makeWorkspace([{ dir: 'a', name: 'a' }, { dir: 'tools/x' }], { root: { name: undefined } });
    expect(allPackages(ws).map(packageLabel)).toEqual(['.', 'a', 'tools/x']);
  });
});
