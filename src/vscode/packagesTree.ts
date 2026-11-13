import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveViewStyle, type ViewStyle, type VisibleScript, visibleScripts } from '../core/scripts';
import { packageLabel, type WorkspacePackage, type WorkspaceProblem } from '../core/types';
import { formatProblem } from './messages';
import type { RunStateTracker } from './runState';
import type { WorkspaceEntry, WorkspaceStore } from './store';

abstract class BaseNode {
  children: TreeNode[] = [];
  constructor(
    readonly id: string,
    readonly parent: TreeNode | undefined,
  ) {}
  abstract toTreeItem(): vscode.TreeItem;
}

export class WorkspaceNode extends BaseNode {
  constructor(readonly entry: WorkspaceEntry) {
    super(`ws:${entry.workspace.root}`, undefined);
  }
  toTreeItem(): vscode.TreeItem {
    const { workspace, folder } = this.entry;
    const item = new vscode.TreeItem(
      workspace.rootPackage.name ?? path.basename(workspace.root),
      vscode.TreeItemCollapsibleState.Expanded,
    );
    item.id = this.id;
    item.description = path.relative(path.dirname(folder.uri.fsPath), workspace.root);
    item.iconPath = new vscode.ThemeIcon('root-folder');
    item.contextValue = 'workspace';
    return item;
  }
}

export class FolderNode extends BaseNode {
  constructor(
    readonly entry: WorkspaceEntry,
    readonly relativeDir: string,
    readonly label: string,
    parent: TreeNode | undefined,
  ) {
    super(`folder:${entry.workspace.root}:${relativeDir}`, parent);
  }
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(this.label, vscode.TreeItemCollapsibleState.Expanded);
    item.id = this.id;
    item.resourceUri = vscode.Uri.file(path.join(this.entry.workspace.root, this.relativeDir));
    item.iconPath = vscode.ThemeIcon.Folder;
    item.contextValue = 'folder';
    return item;
  }
}

export class PackageNode extends BaseNode {
  constructor(
    readonly entry: WorkspaceEntry,
    readonly pkg: WorkspacePackage,
    parent: TreeNode | undefined,
  ) {
    super(`pkg:${pkg.manifestPath}`, parent);
  }
  toTreeItem(): vscode.TreeItem {
    const { pkg, entry } = this;
    const item = new vscode.TreeItem(
      packageLabel(pkg),
      this.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = this.id;
    item.description = pkg.isRoot ? vscode.l10n.t('root') : pkg.version;
    item.iconPath = new vscode.ThemeIcon('package');
    item.contextValue = pkg.isRoot ? 'package:root' : 'package';

    const deps = entry.graph.dependenciesOf(pkg, true).map(packageLabel);
    const dependents = entry.graph.dependentsOf(pkg, true).map(packageLabel);
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(
      `**${packageLabel(pkg)}**${pkg.version ? ` \`${pkg.version}\`` : ''}${pkg.private ? ' · private' : ''}\n\n`,
    );
    md.appendMarkdown(`$(folder) \`${pkg.relativeDir || '.'}\`\n\n`);
    if (deps.length) {
      md.appendMarkdown(`${vscode.l10n.t('Depends on')}: ${deps.map((d) => `\`${d}\``).join(', ')}\n\n`);
    }
    if (dependents.length) {
      md.appendMarkdown(`${vscode.l10n.t('Used by')}: ${dependents.map((d) => `\`${d}\``).join(', ')}\n\n`);
    }
    item.tooltip = md;
    return item;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
}

export class ScriptNode extends BaseNode {
  constructor(
    readonly entry: WorkspaceEntry,
    readonly pkg: WorkspacePackage,
    readonly script: VisibleScript,
    private readonly runs: RunStateTracker,
    parent: PackageNode,
  ) {
    super(`script:${pkg.manifestPath}:${script.name}`, parent);
  }
  get name(): string {
    return this.script.name;
  }
  toTreeItem(): vscode.TreeItem {
    const { script } = this;
    const state = this.runs.get(this.pkg.dir, script.name);
    const item = new vscode.TreeItem(script.name, vscode.TreeItemCollapsibleState.None);
    item.id = this.id;
    const base = this.pkg.isRoot ? 'script:root' : 'script';

    const tooltip = new vscode.MarkdownString(undefined, true);
    if (script.pre) tooltip.appendCodeblock(`# pre${script.name}\n${script.pre}`, 'shellscript');
    tooltip.appendCodeblock(script.command, 'shellscript');
    if (script.post) tooltip.appendCodeblock(`# post${script.name}\n${script.post}`, 'shellscript');

    if (state?.kind === 'running') {
      item.iconPath = new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('charts.blue'));
      item.description = vscode.l10n.t('running');
      item.contextValue = `${base}:running`;
    } else if (state?.kind === 'done') {
      const ok = state.exitCode === 0;
      item.iconPath = new vscode.ThemeIcon(
        ok ? 'pass' : 'error',
        new vscode.ThemeColor(ok ? 'testing.iconPassed' : 'testing.iconFailed'),
      );
      const exit =
        state.exitCode === undefined ? vscode.l10n.t('stopped') : vscode.l10n.t('exit {0}', state.exitCode);
      item.description = ok ? formatDuration(state.durationMs) : exit;
      tooltip.appendMarkdown(
        `\n\n${ok ? '$(pass)' : '$(error)'} ${vscode.l10n.t('Last run')}: ${exit}, ${formatDuration(state.durationMs)}`,
      );
      item.contextValue = base;
    } else {
      item.iconPath = new vscode.ThemeIcon('circle-small');
      item.contextValue = base;
    }
    item.tooltip = tooltip;

    const action = vscode.workspace
      .getConfiguration('bunCompanion')
      .get<string>('packagesView.scriptClickAction');
    item.command = {
      command: action === 'run' ? 'bunCompanion.runScript' : 'bunCompanion.openScript',
      title: '',
      arguments: [this],
    };
    return item;
  }
}

export class ProblemsNode extends BaseNode {
  constructor(
    readonly entry: WorkspaceEntry,
    parent: TreeNode | undefined,
  ) {
    super(`problems:${entry.workspace.root}`, parent);
  }
  toTreeItem(): vscode.TreeItem {
    const item = new vscode.TreeItem(
      vscode.l10n.t('{0} problems', this.children.length),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = this.id;
    item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
    item.contextValue = 'problems';
    return item;
  }
}

export class ProblemNode extends BaseNode {
  constructor(
    readonly entry: WorkspaceEntry,
    readonly problem: WorkspaceProblem,
    index: number,
    parent: ProblemsNode,
  ) {
    super(`problem:${entry.workspace.root}:${index}`, parent);
  }
  toTreeItem(): vscode.TreeItem {
    const label = formatProblem(this.problem, this.entry.workspace.root);
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.id = this.id;
    item.tooltip = label;
    item.iconPath = new vscode.ThemeIcon('circle-small-filled');
    item.contextValue = 'problem';
    const file =
      this.problem.kind === 'invalid-manifest' || this.problem.kind === 'unnamed-package'
        ? this.problem.manifestPath
        : this.problem.kind === 'duplicate-name'
          ? this.problem.manifestPaths[0]
          : undefined;
    if (file) item.command = { command: 'vscode.open', title: '', arguments: [vscode.Uri.file(file)] };
    return item;
  }
}

export type TreeNode = WorkspaceNode | FolderNode | PackageNode | ScriptNode | ProblemsNode | ProblemNode;

export class PackagesTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private roots: TreeNode[] = [];
  private readonly packageNodes = new Map<string, PackageNode>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private currentStyle: ViewStyle = 'list';

  constructor(
    private readonly store: WorkspaceStore,
    private readonly runs: RunStateTracker,
  ) {
    this.disposables.push(
      store.onDidChange(() => this.rebuild()),
      runs.onDidChange(() => this.changeEmitter.fire(undefined)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('bunCompanion.packagesView')) this.rebuild();
      }),
    );
    this.rebuild();
  }

  get style(): ViewStyle {
    return this.currentStyle;
  }

  rebuild(): void {
    const setting = vscode.workspace.getConfiguration('bunCompanion').get<string>('packagesView.style');
    const styles = new Map(
      this.store.workspaces.map((e) => [e, resolveViewStyle(setting, e.workspace.packages)] as const),
    );
    this.currentStyle = [...styles.values()].includes('tree') ? 'tree' : 'list';
    void vscode.commands.executeCommand('setContext', 'bunCompanion.viewStyle', this.currentStyle);
    this.packageNodes.clear();

    const entries = this.store.workspaces;
    if (entries.length === 1 && entries[0]) {
      this.roots = this.workspaceChildren(entries[0], undefined, styles.get(entries[0]) ?? 'list');
    } else {
      this.roots = entries.map((entry) => {
        const node = new WorkspaceNode(entry);
        node.children = this.workspaceChildren(entry, node, styles.get(entry) ?? 'list');
        return node;
      });
    }
    this.changeEmitter.fire(undefined);
  }

  private workspaceChildren(
    entry: WorkspaceEntry,
    parent: TreeNode | undefined,
    style: ViewStyle,
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    const { workspace } = entry;
    if (workspace.problems.length > 0) {
      const problems = new ProblemsNode(entry, parent);
      problems.children = workspace.problems.map((p, i) => new ProblemNode(entry, p, i, problems));
      nodes.push(problems);
    }
    nodes.push(this.packageNode(entry, workspace.rootPackage, parent));
    if (style === 'list') {
      for (const pkg of workspace.packages) nodes.push(this.packageNode(entry, pkg, parent));
    } else {
      nodes.push(...this.folderTree(entry, parent));
    }
    return nodes;
  }

  private packageNode(
    entry: WorkspaceEntry,
    pkg: WorkspacePackage,
    parent: TreeNode | undefined,
  ): PackageNode {
    const node = new PackageNode(entry, pkg, parent);
    node.children = visibleScripts(pkg.scripts).map((s) => new ScriptNode(entry, pkg, s, this.runs, node));
    this.packageNodes.set(path.resolve(pkg.manifestPath), node);
    return node;
  }

  private folderTree(entry: WorkspaceEntry, parent: TreeNode | undefined): TreeNode[] {
    interface Dir {
      dirs: Map<string, Dir>;
      packages: WorkspacePackage[];
    }
    const top: Dir = { dirs: new Map(), packages: [] };
    for (const pkg of entry.workspace.packages) {
      let dir = top;
      for (const segment of pkg.relativeDir.split('/').slice(0, -1)) {
        let next = dir.dirs.get(segment);
        if (!next) {
          next = { dirs: new Map(), packages: [] };
          dir.dirs.set(segment, next);
        }
        dir = next;
      }
      dir.packages.push(pkg);
    }

    const build = (dir: Dir, prefix: string, parentNode: TreeNode | undefined): TreeNode[] => {
      const out: TreeNode[] = [];
      for (const [segment, child] of [...dir.dirs].sort(([a], [b]) => a.localeCompare(b))) {
        let label = segment;
        let rel = prefix ? `${prefix}/${segment}` : segment;
        let current = child;
        while (current.packages.length === 0 && current.dirs.size === 1) {
          const [[nextSegment, next]] = [...current.dirs] as [[string, Dir]];
          label = `${label}/${nextSegment}`;
          rel = `${rel}/${nextSegment}`;
          current = next;
        }
        const folder = new FolderNode(entry, rel, label, parentNode);
        folder.children = build(current, rel, folder);
        out.push(folder);
      }
      for (const pkg of dir.packages) out.push(this.packageNode(entry, pkg, parentNode));
      return out;
    };
    return build(top, '', parent);
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    return node.toTreeItem();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? node.children : this.roots;
  }

  getParent(node: TreeNode): TreeNode | undefined {
    return node.parent;
  }

  findPackageNode(manifestPath: string): PackageNode | undefined {
    return this.packageNodes.get(path.resolve(manifestPath));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
