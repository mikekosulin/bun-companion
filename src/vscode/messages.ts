import * as path from 'node:path';
import * as vscode from 'vscode';
import type { LintIssue } from '../core/lint';
import { DEFAULT_CATALOG, type WorkspaceProblem } from '../core/types';

function catalogLabel(catalog: string): string {
  return catalog === DEFAULT_CATALOG
    ? vscode.l10n.t('the default catalog')
    : vscode.l10n.t('catalog "{0}"', catalog);
}

export function formatProblem(problem: WorkspaceProblem, root: string): string {
  switch (problem.kind) {
    case 'invalid-manifest':
      return vscode.l10n.t('Invalid {0}: {1}', path.relative(root, problem.manifestPath), problem.message);
    case 'unnamed-package':
      return vscode.l10n.t('{0} has no "name"; Bun will not link or install it', problem.relativeDir);
    case 'duplicate-name':
      return vscode.l10n.t('"{0}" is used by {1} packages', problem.name, problem.manifestPaths.length);
    case 'dependency-cycle':
      return vscode.l10n.t('Dependency cycle: {0}', problem.packages.join(' ↔ '));
  }
}

export function formatLintIssue(issue: LintIssue): string {
  const hint = (suggestions: readonly string[]) =>
    suggestions.length > 0
      ? ` ${vscode.l10n.t('Did you mean {0}?', suggestions.map((s) => `"${s}"`).join(', '))}`
      : '';
  switch (issue.code) {
    case 'unknown-workspace-package':
      return vscode.l10n.t('No workspace package named "{0}".', issue.name) + hint(issue.suggestions);
    case 'unknown-workspace-path':
      return vscode.l10n.t('No workspace package at "{0}".', issue.path);
    case 'unknown-catalog':
      return (
        vscode.l10n.t('Catalog "{0}" is not defined in the root package.json.', issue.catalog) +
        hint(issue.suggestions)
      );
    case 'catalog-default-conflict':
      return vscode.l10n.t(
        '"{0}" is defined in both "catalog" and "catalogs.default"; Bun rejects this.',
        issue.dependency,
      );
    case 'missing-catalog-entry':
      return vscode.l10n.t('"{0}" is not in {1}.', issue.dependency, catalogLabel(issue.catalog));
    case 'duplicate-package-name':
      return vscode.l10n.t(
        'Another workspace package is also named "{0}" ({1}).',
        issue.name,
        issue.others.join(', '),
      );
  }
}
