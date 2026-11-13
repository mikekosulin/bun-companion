import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseWorkspaceSpec } from '../core/graph';
import { type LintIssue, lintManifest } from '../core/lint';
import { catalogNameFromSpec } from '../core/manifest';
import {
  type DependencyNode,
  findCatalogEntry,
  findDependencyNodes,
  findNameNode,
  findSpecNodes,
  getCompletionContext,
  type Span,
  type SpecNode,
  spanContains,
} from '../core/packageJsonAst';
import { allPackages, DEFAULT_CATALOG, packageLabel } from '../core/types';
import { formatLintIssue } from './messages';
import type { PackageMatch, WorkspaceStore } from './store';

export const PACKAGE_JSON_SELECTOR: vscode.DocumentSelector = {
  language: 'json',
  scheme: 'file',
  pattern: '**/package.json',
};
const SOURCE = 'Bun Companion';

function toRange(document: vscode.TextDocument, span: Span): vscode.Range {
  return new vscode.Range(document.positionAt(span.offset), document.positionAt(span.offset + span.length));
}

function dependencyAt(document: vscode.TextDocument, position: vscode.Position): SpecNode | undefined {
  const offset = document.offsetAt(position);
  return findSpecNodes(document.getText()).find(
    (d) => spanContains(d.key, offset) || spanContains(d.value, offset),
  );
}

async function readDocument(fsPath: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
}

async function nameRange(fsPath: string): Promise<vscode.Range> {
  const document = await readDocument(fsPath);
  const span = findNameNode(document.getText());
  return span ? toRange(document, span) : new vscode.Range(0, 0, 0, 0);
}

function catalogDisplayName(catalog: string): string {
  return catalog === DEFAULT_CATALOG
    ? vscode.l10n.t('default catalog')
    : vscode.l10n.t('catalog "{0}"', catalog);
}

class DependencyDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly store: WorkspaceStore) {}

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.LocationLink[] | undefined> {
    const match = this.store.findPackageByManifest(document.uri.fsPath);
    const dep = dependencyAt(document, position);
    if (!match || !dep) return undefined;
    const onValue = spanContains(dep.value, document.offsetAt(position));
    const origin = toRange(document, onValue ? dep.value : dep.key);

    const catalog = catalogNameFromSpec(dep.spec);
    if (catalog !== undefined && onValue) {
      const rootDoc = await readDocument(match.entry.workspace.rootPackage.manifestPath);
      const entry = findCatalogEntry(rootDoc.getText(), catalog, dep.name);
      if (!entry) return undefined;
      const target = toRange(rootDoc, entry.key);
      return [
        {
          originSelectionRange: origin,
          targetUri: rootDoc.uri,
          targetRange: target,
          targetSelectionRange: target,
        },
      ];
    }

    if (dep.field === 'overrides') return undefined;
    const target = match.entry.graph.resolve(match.pkg, { ...dep, field: dep.field });
    if (!target) return undefined;
    const range = await nameRange(target.manifestPath);
    return [
      {
        originSelectionRange: origin,
        targetUri: vscode.Uri.file(target.manifestPath),
        targetRange: range,
        targetSelectionRange: range,
      },
    ];
  }
}

class DependencyHoverProvider implements vscode.HoverProvider {
  constructor(private readonly store: WorkspaceStore) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const match = this.store.findPackageByManifest(document.uri.fsPath);
    const dep = dependencyAt(document, position);
    if (!match || !dep) return undefined;
    const md = new vscode.MarkdownString(undefined, true);

    const catalog = catalogNameFromSpec(dep.spec);
    if (catalog !== undefined) {
      const range = match.entry.workspace.catalogs.get(catalog)?.get(dep.name);
      if (range === undefined) return undefined;
      md.appendMarkdown(`$(book) ${catalogDisplayName(catalog)}: \`${dep.name}\` → \`${range}\``);
      return new vscode.Hover(md, toRange(document, dep.value));
    }

    if (dep.field === 'overrides') return undefined;
    const target = match.entry.graph.resolve(match.pkg, { ...dep, field: dep.field });
    if (!target) return undefined;
    md.appendMarkdown(
      `$(package) **${packageLabel(target)}**${target.version ? ` \`${target.version}\`` : ''}\n\n`,
    );
    md.appendMarkdown(`${vscode.l10n.t('Workspace package at')} \`${target.relativeDir || '.'}\``);
    if (!parseWorkspaceSpec(dep.spec)) {
      md.appendMarkdown(`\n\n${vscode.l10n.t('Linked by name. Use "workspace:*" to make it explicit.')}`);
    }
    return new vscode.Hover(
      md,
      toRange(document, spanContains(dep.key, document.offsetAt(position)) ? dep.key : dep.value),
    );
  }
}

class DependencyCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly store: WorkspaceStore) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const match = this.store.findPackageByManifest(document.uri.fsPath);
    if (!match) return undefined;
    const context = getCompletionContext(document.getText(), document.offsetAt(position));
    if (!context) return undefined;
    const range = toRange(document, context.span);
    const { workspace, graph } = match.entry;

    if (context.kind === 'dependencyKey') {
      const present = new Set(
        findDependencyNodes(document.getText())
          .filter((d) => d.field === context.field)
          .map((d) => d.name),
      );
      return allPackages(workspace)
        .filter((p) => p.name !== undefined && p !== match.pkg && !present.has(p.name))
        .map((p) => {
          const item = new vscode.CompletionItem(p.name as string, vscode.CompletionItemKind.Module);
          item.range = range;
          item.detail = vscode.l10n.t('Workspace package');
          item.documentation = p.relativeDir;
          item.sortText = `0_${p.name}`;
          return item;
        });
    }

    const items: vscode.CompletionItem[] = [];
    if (context.field === 'overrides' && !match.pkg.isRoot) return undefined;
    const isWorkspacePackage =
      context.field !== 'overrides' && graph.packageByName(context.dependency) !== undefined;
    if (isWorkspacePackage) {
      ['workspace:*', 'workspace:^', 'workspace:~'].forEach((spec, i) => {
        const item = new vscode.CompletionItem(spec, vscode.CompletionItemKind.Value);
        item.range = range;
        item.detail = vscode.l10n.t('Workspace protocol');
        item.sortText = `0_${i}`;
        item.preselect = i === 0;
        items.push(item);
      });
    }
    for (const [catalog, entries] of workspace.catalogs) {
      const version = entries.get(context.dependency);
      if (version === undefined) continue;
      const spec = catalog === DEFAULT_CATALOG ? 'catalog:' : `catalog:${catalog}`;
      const item = new vscode.CompletionItem(spec, vscode.CompletionItemKind.Reference);
      item.range = range;
      item.detail = `${catalogDisplayName(catalog)} → ${version}`;
      item.sortText = `1_${catalog === DEFAULT_CATALOG ? '' : catalog}`;
      item.preselect = !isWorkspacePackage && catalog === DEFAULT_CATALOG;
      items.push(item);
    }
    return items;
  }
}

class DependencyCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly store: WorkspaceStore) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!context.diagnostics.some((d) => d.source === SOURCE)) return [];
    const match = this.store.findPackageByManifest(document.uri.fsPath);
    if (!match) return [];
    const text = document.getText();
    const deps = findDependencyNodes(text);
    const actions: vscode.CodeAction[] = [];
    for (const issue of lintManifest(text, match.pkg, match.entry.workspace, match.entry.graph)) {
      const issueRange = toRange(document, issue.span);
      if (!issueRange.intersection(range)) continue;
      const diagnostic = context.diagnostics.find((d) => d.source === SOURCE && d.range.isEqual(issueRange));
      const replacements = this.replacementsFor(issue, deps);
      replacements.forEach(([title, replacement], i) => {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, issueRange, replacement);
        action.isPreferred = i === 0;
        if (diagnostic) action.diagnostics = [diagnostic];
        actions.push(action);
      });
    }
    return actions;
  }

  private replacementsFor(issue: LintIssue, deps: DependencyNode[]): [string, string][] {
    switch (issue.code) {
      case 'unknown-workspace-package': {
        const dep = deps.find(
          (d) => d.key.offset === issue.span.offset || d.value.offset === issue.span.offset,
        );
        const ws = dep && parseWorkspaceSpec(dep.spec);
        return issue.suggestions.map((s) => [
          vscode.l10n.t('Change to "{0}"', s),
          ws?.kind === 'alias' ? `workspace:${s}@${ws.range}` : s,
        ]);
      }
      case 'unknown-catalog':
        return issue.suggestions.map((s) => [vscode.l10n.t('Change to "catalog:{0}"', s), `catalog:${s}`]);
      default:
        return [];
    }
  }
}

export class ManifestDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('bunCompanion');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly store: WorkspaceStore) {
    this.disposables = [
      this.collection,
      store.onDidChange(() => this.refreshAll()),
      vscode.workspace.onDidOpenTextDocument((d) => this.refresh(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('bunCompanion.diagnostics')) this.refreshAll();
      }),
    ];
    this.refreshAll();
  }

  get(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return this.collection.get(uri) ?? [];
  }

  refreshAll(): void {
    this.collection.clear();
    for (const document of vscode.workspace.textDocuments) this.refresh(document);
  }

  private schedule(document: vscode.TextDocument): void {
    if (path.basename(document.uri.fsPath) !== 'package.json') return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.refresh(document);
      }, 250),
    );
  }

  refresh(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file' || path.basename(document.uri.fsPath) !== 'package.json') return;
    const enabled = vscode.workspace
      .getConfiguration('bunCompanion', document.uri)
      .get<boolean>('diagnostics.enabled', true);
    const match: PackageMatch | undefined = enabled
      ? this.store.findPackageByManifest(document.uri.fsPath)
      : undefined;
    if (!match) {
      this.collection.delete(document.uri);
      return;
    }
    const issues = lintManifest(document.getText(), match.pkg, match.entry.workspace, match.entry.graph);
    this.collection.set(
      document.uri,
      issues.map((issue) => {
        const severity =
          issue.code === 'duplicate-package-name'
            ? vscode.DiagnosticSeverity.Warning
            : vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(
          toRange(document, issue.span),
          formatLintIssue(issue),
          severity,
        );
        diagnostic.source = SOURCE;
        diagnostic.code = issue.code;
        if (issue.code === 'duplicate-package-name') {
          diagnostic.relatedInformation = allPackages(match.entry.workspace)
            .filter((p) => p !== match.pkg && p.name === issue.name)
            .map(
              (p) =>
                new vscode.DiagnosticRelatedInformation(
                  new vscode.Location(vscode.Uri.file(p.manifestPath), new vscode.Position(0, 0)),
                  vscode.l10n.t('Also named "{0}"', issue.name),
                ),
            );
        }
        return diagnostic;
      }),
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const d of this.disposables) d.dispose();
  }
}

export function registerLanguageFeatures(store: WorkspaceStore): vscode.Disposable[] {
  return [
    vscode.languages.registerDefinitionProvider(
      PACKAGE_JSON_SELECTOR,
      new DependencyDefinitionProvider(store),
    ),
    vscode.languages.registerHoverProvider(PACKAGE_JSON_SELECTOR, new DependencyHoverProvider(store)),
    vscode.languages.registerCompletionItemProvider(
      PACKAGE_JSON_SELECTOR,
      new DependencyCompletionProvider(store),
      '"',
      ':',
    ),
    vscode.languages.registerCodeActionsProvider(
      PACKAGE_JSON_SELECTOR,
      new DependencyCodeActionProvider(store),
      {
        providedCodeActionKinds: DependencyCodeActionProvider.kinds,
      },
    ),
  ];
}
