import * as path from 'node:path';
import type {
  BunWorkspace,
  Catalogs,
  DependencyEntry,
  DependencyField,
  WorkspacePackage,
} from '../../src/core/types';

export const ROOT = path.resolve('/repo');

export interface PackageInit {
  dir: string;
  name?: string;
  version?: string;
  scripts?: Record<string, string>;
  deps?: Partial<Record<DependencyField, Record<string, string>>>;
}

export function makePackage(init: PackageInit, root = ROOT): WorkspacePackage {
  const dir = path.join(root, ...init.dir.split('/').filter(Boolean));
  const dependencies: DependencyEntry[] = [];
  for (const [field, record] of Object.entries(init.deps ?? {})) {
    for (const [name, spec] of Object.entries(record ?? {})) {
      dependencies.push({ name, spec, field: field as DependencyField });
    }
  }
  return {
    name: init.name,
    version: init.version,
    private: false,
    dir,
    relativeDir: init.dir,
    manifestPath: path.join(dir, 'package.json'),
    isRoot: init.dir === '',
    scripts: init.scripts ?? {},
    dependencies,
  };
}

export function makeWorkspace(
  packages: PackageInit[],
  options: { root?: Omit<PackageInit, 'dir'>; catalogs?: Record<string, Record<string, string>> } = {},
): BunWorkspace {
  const catalogs: Catalogs = new Map(
    Object.entries(options.catalogs ?? {}).map(([k, v]) => [k, new Map(Object.entries(v))]),
  );
  return {
    root: ROOT,
    detectedBy: 'bun.lock',
    lockfile: 'bun.lock',
    patterns: ['packages/*'],
    rootPackage: makePackage({ name: 'root', ...options.root, dir: '' }),
    packages: packages.map((p) => makePackage(p)).sort((a, b) => a.relativeDir.localeCompare(b.relativeDir)),
    catalogs,
    problems: [],
  };
}

export function byName(ws: BunWorkspace, name: string): WorkspacePackage {
  const found = [ws.rootPackage, ...ws.packages].find((p) => p.name === name);
  if (!found) throw new Error(`no package ${name}`);
  return found;
}
