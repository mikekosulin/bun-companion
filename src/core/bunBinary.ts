import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseVersion, type Version } from './version';

export type BunSource = 'setting' | 'bun.runtime' | 'PATH' | 'BUN_INSTALL' | 'home' | 'system';

export interface BunLocation {
  readonly path: string;
  readonly source: BunSource;
}

export interface LocateResult {
  readonly location: BunLocation | undefined;
  readonly invalidSetting?: string;
}

export interface LocateOptions {
  readonly configuredPath?: string;
  readonly officialRuntime?: string;
  readonly workspaceRoot?: string;
}

export interface LocateEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  isExecutable(file: string): Promise<boolean>;
}

export async function defaultIsExecutable(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    if (process.platform === 'win32') return true;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function nodeEnvironment(): LocateEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    isExecutable: defaultIsExecutable,
  };
}

function executableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'bun.exe' : 'bun';
}

function pathApi(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function isBareCommand(value: string): boolean {
  return !/[\\/]/.test(value);
}

async function searchPath(command: string, envir: LocateEnvironment): Promise<string | undefined> {
  const p = pathApi(envir.platform);
  const pathVar = envir.env.PATH ?? envir.env.Path ?? '';
  const names =
    envir.platform === 'win32' && !command.toLowerCase().endsWith('.exe') ? [`${command}.exe`] : [command];
  for (const dir of pathVar.split(envir.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = p.join(dir, name);
      if (await envir.isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

export async function locateBun(
  options: LocateOptions,
  envir: LocateEnvironment = nodeEnvironment(),
): Promise<LocateResult> {
  const p = pathApi(envir.platform);
  const exe = executableName(envir.platform);
  let invalidSetting: string | undefined;

  const configured = options.configuredPath?.trim();
  if (configured) {
    const resolved = isBareCommand(configured)
      ? await searchPath(configured, envir)
      : p.resolve(options.workspaceRoot ?? envir.homedir, configured.replace(/^~(?=$|[\\/])/, envir.homedir));
    if (resolved && (await envir.isExecutable(resolved))) {
      return { location: { path: resolved, source: 'setting' } };
    }
    invalidSetting = configured;
  }

  const official = options.officialRuntime?.trim();
  if (official && official !== 'bun') {
    const resolved = isBareCommand(official) ? await searchPath(official, envir) : official;
    if (resolved && (await envir.isExecutable(resolved))) {
      return { location: { path: resolved, source: 'bun.runtime' }, invalidSetting };
    }
  }

  const onPath = await searchPath('bun', envir);
  if (onPath) return { location: { path: onPath, source: 'PATH' }, invalidSetting };

  const candidates: [string, BunSource][] = [];
  if (envir.env.BUN_INSTALL) candidates.push([p.join(envir.env.BUN_INSTALL, 'bin', exe), 'BUN_INSTALL']);
  candidates.push([p.join(envir.homedir, '.bun', 'bin', exe), 'home']);
  if (envir.platform !== 'win32') {
    candidates.push(['/opt/homebrew/bin/bun', 'system'], ['/usr/local/bin/bun', 'system']);
  }
  for (const [candidate, source] of candidates) {
    if (await envir.isExecutable(candidate)) return { location: { path: candidate, source }, invalidSetting };
  }
  return { location: undefined, invalidSetting };
}

export type ExecVersion = (file: string) => Promise<string>;

export const execVersion: ExecVersion = (file) =>
  new Promise((resolve, reject) => {
    execFile(file, ['--version'], { timeout: 5000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });

export async function readBunVersion(
  file: string,
  exec: ExecVersion = execVersion,
): Promise<Version | undefined> {
  try {
    return parseVersion(await exec(file));
  } catch {
    return undefined;
  }
}
