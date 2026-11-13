import type { WorkspacePackage } from './types';

export interface VisibleScript {
  readonly name: string;
  readonly command: string;
  readonly pre: string | undefined;
  readonly post: string | undefined;
}

// Bun runs `pre<name>` and `post<name>` around `<name>`, so they are shown as part of it.
export function visibleScripts(scripts: Readonly<Record<string, string>>): VisibleScript[] {
  const isHook = (name: string) =>
    (name.startsWith('pre') && name.slice(3) in scripts) ||
    (name.startsWith('post') && name.slice(4) in scripts);
  return Object.entries(scripts)
    .filter(([name]) => !isHook(name))
    .map(([name, command]) => ({ name, command, pre: scripts[`pre${name}`], post: scripts[`post${name}`] }));
}

export type ViewStyle = 'list' | 'tree';

const AUTO_TREE_THRESHOLD = 10;

export function resolveViewStyle(
  setting: string | undefined,
  packages: readonly WorkspacePackage[],
): ViewStyle {
  if (setting === 'list' || setting === 'tree') return setting;
  const topFolders = new Set(packages.map((p) => p.relativeDir.split('/')[0]));
  const nested = packages.some((p) => p.relativeDir.includes('/'));
  return packages.length > AUTO_TREE_THRESHOLD || (nested && topFolders.size > 1) ? 'tree' : 'list';
}
