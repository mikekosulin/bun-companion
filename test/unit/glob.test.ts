import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import * as path from 'node:path';
import { compileGlob, expandBraces, globDirectories, isGlob, walkDirectories } from '../../src/core/glob';
import { createTree, removeTree, type TreeSpec } from '../helpers/tree';

const created: string[] = [];
async function tree(spec: TreeSpec): Promise<string> {
  const dir = await createTree(spec);
  created.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(created.splice(0).map(removeTree));
});

describe('isGlob', () => {
  test.each([
    ['packages/*', true],
    ['apps/{web,api}', true],
    ['pkg?', true],
    ['[ab]', true],
    ['packages/ui', false],
    ['../shared', false],
  ])('%p -> %p', (pattern, expected) => {
    expect(isGlob(pattern)).toBe(expected);
  });
});

describe('expandBraces', () => {
  test.each([
    ['a/{b,c}', ['a/b', 'a/c']],
    ['{a,b}/{c,d}', ['a/c', 'a/d', 'b/c', 'b/d']],
    ['a/{b,{c,d}}', ['a/b', 'a/c', 'a/d']],
    ['a/{b}', ['a/{b}']],
    ['a/{b}/{c,d}', ['a/{b}/c', 'a/{b}/d']],
    ['a/{b,c', ['a/{b,c']],
    ['plain', ['plain']],
  ])('%p', (pattern, expected) => {
    expect(expandBraces(pattern)).toEqual(expected);
  });
});

describe('compileGlob', () => {
  test.each([
    ['packages/*', 'packages/ui', true],
    ['packages/*', 'packages/ui/nested', false],
    ['packages/*', 'packages', false],
    ['packages/*', 'packages/.hidden', false],
    ['packages/.*', 'packages/.hidden', true],
    ['packages/**', 'packages', true],
    ['packages/**', 'packages/a/b/c', true],
    ['packages/**', 'packages/.cache/x', false],
    ['**/fixtures/**', 'packages/a/fixtures/x', true],
    ['**/fixtures/**', 'fixtures', true],
    ['pkg-?', 'pkg-a', true],
    ['pkg-?', 'pkg-ab', false],
    ['pkg-[abc]', 'pkg-b', true],
    ['pkg-[!abc]', 'pkg-b', false],
    ['pkg-[^abc]', 'pkg-d', true],
    ['pkg-[a-c]', 'pkg-c', true],
    ['pkg-[', 'pkg-[', true],
    ['apps/{web,api}', 'apps/api', true],
    ['apps/{web,api}', 'apps/docs', false],
    ['../libs/*', '../libs/x', true],
    ['a.b/*', 'a.b/c', true],
    ['a.b/*', 'axb/c', false],
    ['a+(b)/*', 'a+(b)/c', true],
    ['./packages/*', 'packages/ui', true],
    ['packages/*', './packages/ui', true],
  ])('%p matches %p: %p', (pattern, candidate, expected) => {
    expect(compileGlob(pattern)(candidate)).toBe(expected);
  });
});

describe('walkDirectories', () => {
  test('visits directories breadth-limited, skipping node_modules, .git and hidden ones', async () => {
    const root = await tree({
      'a/b/c/d.txt': '',
      'a/file.txt': '',
      'node_modules/x/y.txt': '',
      '.git/objects/z': '',
      '.cache/w': '',
      'e/f.txt': '',
    });
    const visited: string[] = [];
    await walkDirectories(root, 2, (rel, abs) => {
      visited.push(rel);
      expect(abs).toBe(path.join(root, ...rel.split('/')));
    });
    expect(visited.sort()).toEqual(['a', 'a/b', 'e']);
  });

  test('follows symlinked directories once and survives cycles and missing starts', async () => {
    const root = await tree({ 'real/pkg/x.txt': '' });
    await symlink(path.join(root, 'real'), path.join(root, 'link'), 'dir');
    await symlink(root, path.join(root, 'real', 'loop'), 'dir');
    await symlink(path.join(root, 'missing'), path.join(root, 'dangling'), 'dir');
    const visited: string[] = [];
    await walkDirectories(root, Number.POSITIVE_INFINITY, (rel) => visited.push(rel));
    expect(visited.filter((v) => v.endsWith('pkg')).length).toBeGreaterThanOrEqual(1);
    expect(visited).not.toContain('dangling');
    const none: string[] = [];
    await walkDirectories(path.join(root, 'nope'), 3, (rel) => none.push(rel));
    expect(none).toEqual([]);
  });

  test('unreadable directories are skipped', async () => {
    const root = await tree({ 'a/x.txt': '' });
    const visited: string[] = [];
    await walkDirectories(path.join(root, 'a', 'x.txt'), 3, (rel) => visited.push(rel));
    expect(visited).toEqual([]);
  });
});

describe('globDirectories', () => {
  test('expands globs below a literal base, literal paths as is', async () => {
    const root = await tree({
      'packages/a/x': '',
      'packages/b/nested/x': '',
      'apps/web/x': '',
      'apps/api/x': '',
    });
    expect((await globDirectories(root, 'packages/*')).sort()).toEqual(['packages/a', 'packages/b']);
    expect((await globDirectories(root, 'packages/**')).sort()).toEqual([
      'packages/a',
      'packages/b',
      'packages/b/nested',
    ]);
    expect((await globDirectories(root, 'apps/{web,api,docs}')).sort()).toEqual([
      'apps/api',
      'apps/docs',
      'apps/web',
    ]);
    expect(await globDirectories(root, 'tools/cli')).toEqual(['tools/cli']);
    expect((await globDirectories(root, '*')).sort()).toEqual(['apps', 'packages']);
  });

  test('patterns that leave the root', async () => {
    const parent = await tree({ 'repo/x': '', 'libs/one/x': '', 'libs/two/x': '' });
    await mkdir(path.join(parent, 'repo', 'apps'), { recursive: true });
    expect((await globDirectories(path.join(parent, 'repo'), '../libs/*')).sort()).toEqual([
      '../libs/one',
      '../libs/two',
    ]);
  });
});
