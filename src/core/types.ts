export type DependencyField =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

export const DEPENDENCY_FIELDS: readonly DependencyField[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];

export interface DependencyEntry {
  readonly name: string;
  readonly spec: string;
  readonly field: DependencyField;
}

export interface WorkspacePackage {
  readonly name: string | undefined;
  readonly version: string | undefined;
  readonly private: boolean;
  readonly dir: string;
  readonly relativeDir: string;
  readonly manifestPath: string;
  readonly isRoot: boolean;
  readonly scripts: Readonly<Record<string, string>>;
  readonly dependencies: readonly DependencyEntry[];
}

export type Catalogs = ReadonlyMap<string, ReadonlyMap<string, string>>;

export const DEFAULT_CATALOG = 'default';

export type DetectionReason = 'bun.lock' | 'bun.lockb' | 'bunfig.toml' | 'packageManager';

export type WorkspaceProblem =
  | { readonly kind: 'invalid-manifest'; readonly manifestPath: string; readonly message: string }
  | { readonly kind: 'unnamed-package'; readonly manifestPath: string; readonly relativeDir: string }
  | { readonly kind: 'duplicate-name'; readonly name: string; readonly manifestPaths: readonly string[] }
  | { readonly kind: 'dependency-cycle'; readonly packages: readonly string[] };

export interface BunWorkspace {
  readonly root: string;
  readonly detectedBy: DetectionReason;
  readonly lockfile: 'bun.lock' | 'bun.lockb' | undefined;
  readonly patterns: readonly string[];
  readonly rootPackage: WorkspacePackage;
  readonly packages: readonly WorkspacePackage[];
  readonly catalogs: Catalogs;
  readonly problems: readonly WorkspaceProblem[];
}

export function packageLabel(pkg: Pick<WorkspacePackage, 'name' | 'relativeDir'>): string {
  return pkg.name ?? (pkg.relativeDir === '' ? '.' : pkg.relativeDir);
}

export function allPackages(ws: BunWorkspace): readonly WorkspacePackage[] {
  return [ws.rootPackage, ...ws.packages];
}
