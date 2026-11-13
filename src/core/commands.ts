import type { WorkspaceGraph } from './graph';
import { type BunWorkspace, packageLabel, type WorkspacePackage } from './types';
import { atLeast, BUN_FEATURES, type Version } from './version';

export type RunTarget =
  | { readonly kind: 'package'; readonly pkg: WorkspacePackage }
  | { readonly kind: 'withDependencies'; readonly pkg: WorkspacePackage }
  | { readonly kind: 'dependents'; readonly pkg: WorkspacePackage }
  | { readonly kind: 'all' };

export interface RunInvocation {
  readonly cwd: string;
  readonly args: readonly string[];
  readonly label: string;
  readonly filters: readonly string[];
}

export function selectorFor(pkg: WorkspacePackage): string {
  return pkg.name ?? `./${pkg.relativeDir}`;
}

function filterArgs(filters: readonly string[]): string[] {
  return filters.flatMap((f) => ['--filter', f]);
}

export function buildRunInvocation(
  workspace: BunWorkspace,
  graph: WorkspaceGraph,
  target: RunTarget,
  script: string,
  bunVersion: Version | undefined,
): RunInvocation {
  const graphSelectors = atLeast(bunVersion, BUN_FEATURES.graphFilters);

  switch (target.kind) {
    case 'package':
      return {
        cwd: target.pkg.dir,
        args: ['run', script],
        label: `${packageLabel(target.pkg)} › ${script}`,
        filters: [],
      };

    case 'withDependencies':
    case 'dependents': {
      const { pkg } = target;
      const forward = target.kind === 'withDependencies';
      let filters: string[];
      if (graphSelectors && pkg.name !== undefined) {
        filters = [forward ? `${pkg.name}...` : `...${pkg.name}`];
      } else {
        const related = graph.closure(pkg, forward ? 'dependencies' : 'dependents');
        filters = [pkg, ...related].filter((p) => !p.isRoot).map(selectorFor);
      }
      const suffix = forward ? '...' : '';
      const prefix = forward ? '' : '...';
      return {
        cwd: workspace.root,
        args: ['run', ...filterArgs(filters), script],
        label: `${prefix}${packageLabel(pkg)}${suffix} › ${script}`,
        filters,
      };
    }

    case 'all': {
      const withScript = workspace.packages.filter((p) => script in p.scripts);
      const filters = withScript.every((p) => p.name !== undefined) ? ['*'] : withScript.map(selectorFor);
      return {
        cwd: workspace.root,
        args: ['run', ...filterArgs(filters), script],
        label: `* › ${script}`,
        filters,
      };
    }
  }
}

export function buildCopyableCommand(
  invocation: RunInvocation,
  platform: NodeJS.Platform,
  pkg?: WorkspacePackage,
): string {
  if (invocation.filters.length > 0) return formatCommandLine(['bun', ...invocation.args], platform);
  if (pkg && !pkg.isRoot && pkg.name !== undefined) {
    const script = invocation.args[invocation.args.length - 1] ?? '';
    return formatCommandLine(['bun', 'run', '--filter', pkg.name, script], platform);
  }
  const command = formatCommandLine(['bun', ...invocation.args], platform);
  if (pkg && !pkg.isRoot) return `cd ${quoteArg(pkg.relativeDir, platform)} && ${command}`;
  return command;
}

const SAFE_POSIX = /^[A-Za-z0-9_\-+=.,/:@%^]+$/;
const SAFE_WINDOWS = /^[A-Za-z0-9_\-+=.,/:@%\\]+$/;

export function quoteArg(arg: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    if (arg !== '' && SAFE_WINDOWS.test(arg)) return arg;
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  if (arg !== '' && SAFE_POSIX.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function formatCommandLine(args: readonly string[], platform: NodeJS.Platform): string {
  return args.map((a) => quoteArg(a, platform)).join(' ');
}

export function scriptsAcrossPackages(workspace: BunWorkspace): Map<string, WorkspacePackage[]> {
  const result = new Map<string, WorkspacePackage[]>();
  for (const pkg of workspace.packages) {
    for (const script of Object.keys(pkg.scripts)) {
      result.set(script, [...(result.get(script) ?? []), pkg]);
    }
  }
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}
