import { describe, expect, test } from 'bun:test';
import { chmod } from 'node:fs/promises';
import * as path from 'node:path';
import {
  defaultIsExecutable,
  execVersion,
  type LocateEnvironment,
  locateBun,
  nodeEnvironment,
  readBunVersion,
} from '../../src/core/bunBinary';
import { createTree, removeTree } from '../helpers/tree';

function fakeEnv(
  executables: string[],
  overrides: Partial<Omit<LocateEnvironment, 'isExecutable'>> = {},
): LocateEnvironment {
  const set = new Set(executables);
  return {
    platform: 'darwin',
    env: { PATH: '/usr/bin:/custom/bin' },
    homedir: '/Users/dev',
    isExecutable: async (file) => set.has(file),
    ...overrides,
  };
}

describe('locateBun', () => {
  test('setting wins (absolute path)', async () => {
    const result = await locateBun(
      { configuredPath: '/opt/bun/bun' },
      fakeEnv(['/opt/bun/bun', '/usr/bin/bun']),
    );
    expect(result).toEqual({ location: { path: '/opt/bun/bun', source: 'setting' } });
  });

  test('setting: relative to the workspace root, ~ expansion, bare command on PATH', async () => {
    const env = fakeEnv(['/repo/tools/bun', '/Users/dev/bin/bun', '/custom/bin/bun-canary']);
    expect(
      (await locateBun({ configuredPath: 'tools/bun', workspaceRoot: '/repo' }, env)).location?.path,
    ).toBe('/repo/tools/bun');
    expect((await locateBun({ configuredPath: '~/bin/bun' }, env)).location?.path).toBe('/Users/dev/bin/bun');
    expect((await locateBun({ configuredPath: 'bun-canary' }, env)).location).toEqual({
      path: '/custom/bin/bun-canary',
      source: 'setting',
    });
  });

  test('an invalid setting is reported but never a dead end', async () => {
    expect(await locateBun({ configuredPath: '/nope/bun' }, fakeEnv(['/custom/bin/bun']))).toEqual({
      location: { path: '/custom/bin/bun', source: 'PATH' },
      invalidSetting: '/nope/bun',
    });
    expect(await locateBun({ configuredPath: 'missing-cmd' }, fakeEnv([]))).toEqual({
      location: undefined,
      invalidSetting: 'missing-cmd',
    });
  });

  test("official extension's bun.runtime is honoured unless it is the default 'bun'", async () => {
    const env = fakeEnv(['/x/bun', '/custom/bin/bun', '/custom/bin/bun-nightly']);
    expect((await locateBun({ officialRuntime: '/x/bun' }, env)).location).toEqual({
      path: '/x/bun',
      source: 'bun.runtime',
    });
    expect((await locateBun({ officialRuntime: 'bun-nightly' }, env)).location?.source).toBe('bun.runtime');
    expect((await locateBun({ officialRuntime: 'bun' }, env)).location?.source).toBe('PATH');
    expect((await locateBun({ officialRuntime: '/missing' }, env)).location?.source).toBe('PATH');
  });

  test('PATH, then BUN_INSTALL, then ~/.bun, then Homebrew', async () => {
    const env = (exes: string[]) => fakeEnv(exes, { env: { PATH: '/usr/bin', BUN_INSTALL: '/opt/bunhome' } });
    expect((await locateBun({}, env(['/usr/bin/bun', '/opt/bunhome/bin/bun']))).location?.source).toBe(
      'PATH',
    );
    expect((await locateBun({}, env(['/opt/bunhome/bin/bun', '/Users/dev/.bun/bin/bun']))).location).toEqual({
      path: '/opt/bunhome/bin/bun',
      source: 'BUN_INSTALL',
    });
    expect((await locateBun({}, env(['/Users/dev/.bun/bin/bun']))).location?.source).toBe('home');
    expect((await locateBun({}, env(['/opt/homebrew/bin/bun']))).location).toEqual({
      path: '/opt/homebrew/bin/bun',
      source: 'system',
    });
    expect((await locateBun({}, env(['/usr/local/bin/bun']))).location?.path).toBe('/usr/local/bin/bun');
    expect((await locateBun({}, env([]))).location).toBeUndefined();
  });

  test('empty PATH entries are skipped and a missing PATH is fine', async () => {
    expect((await locateBun({}, fakeEnv(['/a/bun'], { env: { PATH: '::/a' } }))).location?.path).toBe(
      '/a/bun',
    );
    expect((await locateBun({}, fakeEnv([], { env: {} }))).location).toBeUndefined();
  });

  test('Windows: Path variable, ; separator, only bun.exe (never .cmd shims)', async () => {
    const env = fakeEnv(['C:\\npm\\bun.cmd', 'C:\\Users\\dev\\.bun\\bin\\bun.exe', 'D:\\tools\\bun.exe'], {
      platform: 'win32',
      env: { Path: 'C:\\npm;D:\\tools' },
      homedir: 'C:\\Users\\dev',
    });
    expect((await locateBun({}, env)).location).toEqual({ path: 'D:\\tools\\bun.exe', source: 'PATH' });
    const noPath = { ...env, env: { BUN_INSTALL: 'E:\\bun' } };
    expect((await locateBun({}, noPath)).location).toEqual({
      path: 'C:\\Users\\dev\\.bun\\bin\\bun.exe',
      source: 'home',
    });
    expect((await locateBun({ configuredPath: 'bun.exe' }, env)).location?.path).toBe('D:\\tools\\bun.exe');
  });
});

describe('readBunVersion', () => {
  test('parses the version printed by the binary', async () => {
    expect(await readBunVersion('/x/bun', async () => '1.4.2\n')).toEqual({ major: 1, minor: 4, patch: 2 });
  });

  test('undefined when the binary fails or prints garbage', async () => {
    expect(await readBunVersion('/x/bun', async () => 'oops')).toBeUndefined();
    expect(
      await readBunVersion('/x/bun', async () => {
        throw new Error('ENOENT');
      }),
    ).toBeUndefined();
  });
});

describe('real filesystem and process', () => {
  test('defaultIsExecutable checks the file mode and type', async () => {
    const dir = await createTree({ 'bin/tool': '#!/bin/sh\necho 9.9.9\n', 'bin/data': 'x', 'dir/x': '' });
    try {
      await chmod(path.join(dir, 'bin', 'tool'), 0o755);
      expect(await defaultIsExecutable(path.join(dir, 'bin', 'tool'))).toBe(true);
      expect(await defaultIsExecutable(path.join(dir, 'bin', 'data'))).toBe(process.platform === 'win32');
      expect(await defaultIsExecutable(path.join(dir, 'dir'))).toBe(false);
      expect(await defaultIsExecutable(path.join(dir, 'missing'))).toBe(false);
      if (process.platform !== 'win32') {
        expect(await execVersion(path.join(dir, 'bin', 'tool'))).toBe('9.9.9\n');
        await expect(execVersion(path.join(dir, 'bin', 'data'))).rejects.toThrow();
      }
    } finally {
      await removeTree(dir);
    }
  });

  test('nodeEnvironment reflects the current process and accepts its runtime binary', async () => {
    const env = nodeEnvironment();
    expect(env.platform).toBe(process.platform);
    const result = await locateBun({ configuredPath: process.execPath }, env);
    expect(result.location?.path).toBe(process.execPath);
    const version = await readBunVersion(process.execPath);
    expect(version?.major).toBeGreaterThanOrEqual(1);
  });
});
