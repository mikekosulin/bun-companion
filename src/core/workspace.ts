import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { compileGlob, globDirectories, isGlob, walkDirectories } from './glob';
import { findCycles } from './graph';
import { type Manifest, parseManifest, readWorkspacesConfig } from './manifest';
import { isInside, normalizePattern, toPosixRelative } from './paths';
import type { BunWorkspace, DetectionReason, WorkspacePackage, WorkspaceProblem } from './types';

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function readManifestFile(manifestPath: string): Promise<Manifest | undefined> {
  const text = await readText(manifestPath);
  if (text === undefined) return undefined;
  const result = parseManifest(text);
  return result.ok ? result.manifest : undefined;
}

export async function detectBun(root: string, manifest: Manifest): Promise<DetectionReason | undefined> {
  if (await isFile(path.join(root, 'bun.lock'))) return 'bun.lock';
  if (await isFile(path.join(root, 'bun.lockb'))) return 'bun.lockb';
  if (manifest.packageManager?.startsWith('bun@')) return 'packageManager';
  if (await isFile(path.join(root, 'bunfig.toml'))) return 'bunfig.toml';
  return undefined;
}

export interface FindRootsOptions {
  readonly maxDepth?: number;
}

export async function findWorkspaceRoots(folder: string, options: FindRootsOptions = {}): Promise<string[]> {
  let dir = path.resolve(folder);
  let nearestProject: string | undefined;
  for (;;) {
    const manifest = await readManifestFile(path.join(dir, 'package.json'));
    if (manifest && readWorkspacesConfig(manifest)) {
      return (await detectBun(dir, manifest)) ? [dir] : [];
    }
    if (manifest && !nearestProject && (await detectBun(dir, manifest))) nearestProject = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (nearestProject) return [nearestProject];

  const dirs = [path.resolve(folder)];
  await walkDirectories(folder, options.maxDepth ?? 2, (_rel, absolute) => dirs.push(absolute));
  const depth = (p: string) => p.split(/[\\/]/).length;
  dirs.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  const candidates: string[] = [];
  for (const root of dirs) {
    const manifestPath = path.join(root, 'package.json');
    if (candidates.some((c) => isInside(c, root))) continue;
    const manifest = await readManifestFile(manifestPath);
    if (manifest && (await detectBun(root, manifest))) candidates.push(root);
  }
  return candidates.map((c) => path.resolve(c));
}

export async function expandWorkspacePatterns(root: string, patterns: readonly string[]): Promise<string[]> {
  const positive: string[] = [];
  const literal: string[] = [];
  const negative: ((relativePath: string) => boolean)[] = [];
  for (const raw of patterns) {
    if (raw.trim().startsWith('!')) {
      negative.push(compileGlob(normalizePattern(raw.trim().slice(1))));
      continue;
    }
    const p = normalizePattern(raw);
    if (p === '' || p === '.') continue;
    (isGlob(p) ? positive : literal).push(p);
  }

  const dirs = new Set<string>();
  const addIfPackage = async (rel: string) => {
    const dir = path.resolve(root, rel);
    if (await isFile(path.join(dir, 'package.json'))) dirs.add(dir);
  };
  for (const pattern of positive) {
    for (const rel of await globDirectories(root, pattern)) {
      if (!negative.some((excluded) => excluded(rel))) await addIfPackage(rel);
    }
  }
  for (const p of literal) await addIfPackage(p);
  dirs.delete(path.resolve(root));
  return [...dirs].sort((a, b) => toPosixRelative(root, a).localeCompare(toPosixRelative(root, b)));
}

function toPackage(root: string, dir: string, manifest: Manifest): WorkspacePackage {
  return {
    name: manifest.name,
    version: manifest.version,
    private: manifest.private,
    dir,
    relativeDir: toPosixRelative(root, dir),
    manifestPath: path.join(dir, 'package.json'),
    isRoot: path.resolve(root) === path.resolve(dir),
    scripts: manifest.scripts,
    dependencies: manifest.dependencies,
  };
}

export async function loadWorkspace(root: string): Promise<BunWorkspace | undefined> {
  const absRoot = path.resolve(root);
  const rootManifestPath = path.join(absRoot, 'package.json');
  const rootText = await readText(rootManifestPath);
  if (rootText === undefined) return undefined;
  const rootResult = parseManifest(rootText);
  if (!rootResult.ok) return undefined;
  const config = readWorkspacesConfig(rootResult.manifest) ?? { patterns: [], catalogs: new Map() };
  const detectedBy = await detectBun(absRoot, rootResult.manifest);
  if (!detectedBy) return undefined;

  const problems: WorkspaceProblem[] = [];
  const dirs = await expandWorkspacePatterns(absRoot, config.patterns);
  const loaded = await Promise.all(
    dirs.map(async (dir) => {
      const manifestPath = path.join(dir, 'package.json');
      const text = await readText(manifestPath);
      if (text === undefined) return undefined;
      const result = parseManifest(text);
      if (!result.ok) {
        problems.push({ kind: 'invalid-manifest', manifestPath, message: result.error });
        return undefined;
      }
      return toPackage(absRoot, dir, result.manifest);
    }),
  );
  const packages = loaded.filter((p): p is WorkspacePackage => p !== undefined);

  for (const pkg of packages) {
    if (pkg.name === undefined) {
      problems.push({
        kind: 'unnamed-package',
        manifestPath: pkg.manifestPath,
        relativeDir: pkg.relativeDir,
      });
    }
  }

  const rootPackage = toPackage(absRoot, absRoot, rootResult.manifest);
  const byName = new Map<string, string[]>();
  for (const pkg of [rootPackage, ...packages]) {
    if (pkg.name === undefined) continue;
    byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg.manifestPath]);
  }
  for (const [name, manifestPaths] of byName) {
    if (manifestPaths.length > 1) problems.push({ kind: 'duplicate-name', name, manifestPaths });
  }

  const lockfile = existsSync(path.join(absRoot, 'bun.lock'))
    ? 'bun.lock'
    : existsSync(path.join(absRoot, 'bun.lockb'))
      ? 'bun.lockb'
      : undefined;

  const workspace: BunWorkspace = {
    root: absRoot,
    detectedBy,
    lockfile,
    patterns: config.patterns,
    rootPackage,
    packages,
    catalogs: config.catalogs,
    problems,
  };

  for (const cycle of findCycles(workspace)) {
    problems.push({ kind: 'dependency-cycle', packages: cycle });
  }
  return workspace;
}
