import * as path from 'node:path';
import { allPackages, type BunWorkspace, type DependencyEntry, type WorkspacePackage } from './types';

export interface InternalEdge {
  readonly from: WorkspacePackage;
  readonly to: WorkspacePackage;
  readonly dependency: DependencyEntry;
  readonly via: 'workspace' | 'name';
}

export type WorkspaceSpec =
  | { readonly kind: 'range'; readonly range: string }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'alias'; readonly name: string; readonly range: string };

export function parseWorkspaceSpec(spec: string): WorkspaceSpec | undefined {
  if (!spec.startsWith('workspace:')) return undefined;
  const rest = spec.slice('workspace:'.length).trim();
  if (rest === '' || /^[\^~*<>=\d]/.test(rest)) return { kind: 'range', range: rest || '*' };
  if (rest.startsWith('.') || rest.startsWith('/')) return { kind: 'path', path: rest };
  const at = rest.lastIndexOf('@');
  if (at > 0) return { kind: 'alias', name: rest.slice(0, at), range: rest.slice(at + 1) || '*' };
  if (rest.startsWith('@') && rest.includes('/')) return { kind: 'alias', name: rest, range: '*' };
  return { kind: 'range', range: rest };
}

export class WorkspaceGraph {
  readonly edges: readonly InternalEdge[];
  private readonly byName = new Map<string, WorkspacePackage>();
  private readonly byDir = new Map<string, WorkspacePackage>();

  constructor(readonly workspace: BunWorkspace) {
    for (const pkg of allPackages(workspace)) {
      if (pkg.name !== undefined && !this.byName.has(pkg.name)) this.byName.set(pkg.name, pkg);
      this.byDir.set(path.resolve(pkg.dir), pkg);
    }
    const edges: InternalEdge[] = [];
    for (const from of allPackages(workspace)) {
      for (const dependency of from.dependencies) {
        const to = this.resolve(from, dependency);
        if (to && to !== from) {
          edges.push({
            from,
            to,
            dependency,
            via: dependency.spec.startsWith('workspace:') ? 'workspace' : 'name',
          });
        }
      }
    }
    this.edges = edges;
  }

  packageByName(name: string): WorkspacePackage | undefined {
    return this.byName.get(name);
  }

  resolve(from: WorkspacePackage, dependency: DependencyEntry): WorkspacePackage | undefined {
    const ws = parseWorkspaceSpec(dependency.spec);
    if (ws) {
      switch (ws.kind) {
        case 'range':
          return this.byName.get(dependency.name);
        case 'alias':
          return this.byName.get(ws.name);
        case 'path':
          return this.byDir.get(path.resolve(from.dir, ws.path));
      }
    }
    if (/^(npm:|file:|link:|git|github:|https?:)/.test(dependency.spec)) return undefined;
    return this.byName.get(dependency.name);
  }

  dependenciesOf(pkg: WorkspacePackage, includePeers = false): WorkspacePackage[] {
    return uniqueSorted(
      this.edges
        .filter((e) => e.from === pkg && (includePeers || e.dependency.field !== 'peerDependencies'))
        .map((e) => e.to),
    );
  }

  dependentsOf(pkg: WorkspacePackage, includePeers = false): WorkspacePackage[] {
    return uniqueSorted(
      this.edges
        .filter((e) => e.to === pkg && (includePeers || e.dependency.field !== 'peerDependencies'))
        .map((e) => e.from),
    );
  }

  closure(pkg: WorkspacePackage, direction: 'dependencies' | 'dependents'): WorkspacePackage[] {
    const seen = new Set<WorkspacePackage>([pkg]);
    const queue = [pkg];
    for (let current = queue.shift(); current; current = queue.shift()) {
      const next = direction === 'dependencies' ? this.dependenciesOf(current) : this.dependentsOf(current);
      for (const n of next) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    seen.delete(pkg);
    return uniqueSorted([...seen]);
  }
}

function uniqueSorted(pkgs: WorkspacePackage[]): WorkspacePackage[] {
  return [...new Set(pkgs)].sort((a, b) => a.relativeDir.localeCompare(b.relativeDir));
}

export function findCycles(workspace: BunWorkspace): string[][] {
  const graph = new WorkspaceGraph(workspace);
  const nodes = allPackages(workspace);
  const index = new Map<WorkspacePackage, number>();
  const low = new Map<WorkspacePackage, number>();
  const onStack = new Set<WorkspacePackage>();
  const stack: WorkspacePackage[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const strongConnect = (v: WorkspacePackage) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.dependenciesOf(v)) {
      if (!index.has(w)) {
        strongConnect(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: WorkspacePackage[] = [];
      let w: WorkspacePackage | undefined;
      do {
        w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) {
        cycles.push(component.map((p) => p.name ?? p.relativeDir).sort());
      }
    }
  };

  for (const v of nodes) if (!index.has(v)) strongConnect(v);
  return cycles.sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));
}
