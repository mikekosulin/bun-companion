import { describe, expect, test } from 'bun:test';
import { resolveViewStyle, visibleScripts } from '../../src/core/scripts';
import { makePackage } from '../helpers/model';

describe('visibleScripts', () => {
  test('folds pre/post hooks into the script they wrap', () => {
    expect(
      visibleScripts({ prebuild: 'gen', build: 'tsc', postbuild: 'done', dev: 'vite', postinstall: 'patch' }),
    ).toEqual([
      { name: 'build', command: 'tsc', pre: 'gen', post: 'done' },
      { name: 'dev', command: 'vite', pre: undefined, post: undefined },
      { name: 'postinstall', command: 'patch', pre: undefined, post: undefined },
    ]);
  });

  test('scripts that merely start with pre/post stay visible', () => {
    expect(visibleScripts({ preview: 'vite preview', prettier: 'x', posts: 'y' }).map((s) => s.name)).toEqual(
      ['preview', 'prettier', 'posts'],
    );
  });

  test('keeps package.json order', () => {
    expect(visibleScripts({ z: '1', a: '2' }).map((s) => s.name)).toEqual(['z', 'a']);
  });
});

describe('resolveViewStyle', () => {
  const pkgs = (...dirs: string[]) => dirs.map((dir) => makePackage({ dir, name: dir }));

  test('explicit settings win', () => {
    expect(resolveViewStyle('list', pkgs('apps/a', 'packages/b'))).toBe('list');
    expect(resolveViewStyle('tree', pkgs('a'))).toBe('tree');
  });

  test('auto: folders when packages live in more than one top-level folder', () => {
    expect(resolveViewStyle('auto', pkgs('apps/a', 'packages/b'))).toBe('tree');
    expect(resolveViewStyle(undefined, pkgs('packages/a', 'packages/b'))).toBe('list');
    expect(resolveViewStyle('auto', pkgs('a', 'b'))).toBe('list');
  });

  test('auto: folders above 10 packages', () => {
    const many = Array.from({ length: 11 }, (_, i) => `packages/p${i}`);
    expect(resolveViewStyle('auto', pkgs(...many))).toBe('tree');
  });
});
