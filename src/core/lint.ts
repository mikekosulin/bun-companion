import { parseWorkspaceSpec, type WorkspaceGraph } from './graph';
import { catalogNameFromSpec } from './manifest';
import { findCatalogDefaultConflicts, findNameNode, findSpecNodes, type Span } from './packageJsonAst';
import { closestMatches } from './strings';
import { allPackages, type BunWorkspace, DEFAULT_CATALOG, type WorkspacePackage } from './types';

export type LintIssue =
  | {
      readonly code: 'unknown-workspace-package';
      readonly span: Span;
      readonly name: string;
      readonly suggestions: readonly string[];
    }
  | { readonly code: 'unknown-workspace-path'; readonly span: Span; readonly path: string }
  | { readonly code: 'catalog-default-conflict'; readonly span: Span; readonly dependency: string }
  | {
      readonly code: 'unknown-catalog';
      readonly span: Span;
      readonly catalog: string;
      readonly suggestions: readonly string[];
    }
  | {
      readonly code: 'missing-catalog-entry';
      readonly span: Span;
      readonly catalog: string;
      readonly dependency: string;
    }
  | {
      readonly code: 'duplicate-package-name';
      readonly span: Span;
      readonly name: string;
      readonly others: readonly string[];
    };

export function lintManifest(
  text: string,
  pkg: WorkspacePackage,
  workspace: BunWorkspace,
  graph: WorkspaceGraph,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const names = allPackages(workspace)
    .map((p) => p.name)
    .filter((n): n is string => n !== undefined);

  for (const dep of findSpecNodes(text)) {
    if (dep.field === 'overrides' && !pkg.isRoot) continue;
    const ws = parseWorkspaceSpec(dep.spec);
    if (ws && dep.field !== 'overrides') {
      if (graph.resolve(pkg, { name: dep.name, spec: dep.spec, field: dep.field })) continue;
      if (ws.kind === 'path') {
        issues.push({ code: 'unknown-workspace-path', span: dep.value, path: ws.path });
      } else {
        const name = ws.kind === 'alias' ? ws.name : dep.name;
        issues.push({
          code: 'unknown-workspace-package',
          span: ws.kind === 'alias' ? dep.value : dep.key,
          name,
          suggestions: closestMatches(name, names),
        });
      }
      continue;
    }

    const catalog = catalogNameFromSpec(dep.spec);
    if (catalog !== undefined) {
      const entries = workspace.catalogs.get(catalog);
      if (!entries) {
        if (catalog === DEFAULT_CATALOG) {
          issues.push({ code: 'missing-catalog-entry', span: dep.value, catalog, dependency: dep.name });
        } else {
          issues.push({
            code: 'unknown-catalog',
            span: dep.value,
            catalog,
            suggestions: closestMatches(catalog, workspace.catalogs.keys()),
          });
        }
      } else if (!entries.has(dep.name)) {
        issues.push({ code: 'missing-catalog-entry', span: dep.value, catalog, dependency: dep.name });
      }
    }
  }

  if (pkg.isRoot) {
    for (const conflict of findCatalogDefaultConflicts(text)) {
      issues.push({ code: 'catalog-default-conflict', span: conflict.key, dependency: conflict.name });
    }
  }

  if (pkg.name !== undefined) {
    const others = allPackages(workspace).filter((p) => p !== pkg && p.name === pkg.name);
    const span = findNameNode(text);
    if (others.length > 0 && span) {
      issues.push({
        code: 'duplicate-package-name',
        span,
        name: pkg.name,
        others: others.map((o) => o.relativeDir || '.'),
      });
    }
  }
  return issues;
}
