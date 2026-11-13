import * as vscode from 'vscode';
import { buildCopyableCommand, buildRunInvocation, scriptsAcrossPackages } from '../core/commands';
import { findScriptNodes } from '../core/packageJsonAst';
import { allPackages, packageLabel, type WorkspacePackage } from '../core/types';
import type { BunService } from './bun';
import { PackageNode, type PackagesTreeProvider, ScriptNode, type TreeNode } from './packagesTree';
import type { ScriptRunner } from './runner';
import type { RunStateTracker } from './runState';
import type { PackageMatch, WorkspaceEntry, WorkspaceStore } from './store';

export interface CommandDeps {
  readonly store: WorkspaceStore;
  readonly bun: BunService;
  readonly runner: ScriptRunner;
  readonly tree: PackagesTreeProvider;
  readonly treeView: vscode.TreeView<TreeNode>;
  readonly runs: RunStateTracker;
  readonly log: vscode.LogOutputChannel;
}

type Arg = TreeNode | vscode.Uri | undefined;

interface ScriptPick extends vscode.QuickPickItem {
  readonly match?: PackageMatch;
  readonly script?: string;
}

function activeFilePath(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri?.scheme === 'file' ? uri.fsPath : undefined;
}

export function packageFromArg(store: WorkspaceStore, arg: Arg): PackageMatch | undefined {
  if (arg instanceof PackageNode || arg instanceof ScriptNode) return { entry: arg.entry, pkg: arg.pkg };
  if (arg instanceof vscode.Uri) return store.findPackageForPath(arg.fsPath);
  return undefined;
}

async function pickWorkspace(store: WorkspaceStore): Promise<WorkspaceEntry | undefined> {
  const entries = store.workspaces;
  if (entries.length <= 1) return entries[0];
  const active = activeFilePath();
  const current = active ? store.findEntryForPath(active) : undefined;
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.workspace.rootPackage.name ?? entry.workspace.root,
      description: entry.workspace.root,
      entry,
      picked: entry === current,
    })),
    { placeHolder: vscode.l10n.t('Select a Bun project') },
  );
  return picked?.entry;
}

function scriptItems(match: PackageMatch): ScriptPick[] {
  return Object.entries(match.pkg.scripts).map(([script, command]) => ({
    label: script,
    description: packageLabel(match.pkg),
    detail: command,
    match,
    script,
  }));
}

async function pickScript(
  store: WorkspaceStore,
  runner: ScriptRunner,
  only?: PackageMatch,
): Promise<ScriptPick | undefined> {
  const items: ScriptPick[] = [];
  const separator = (label: string): ScriptPick => ({ label, kind: vscode.QuickPickItemKind.Separator });

  if (only) {
    items.push(...scriptItems(only));
  } else {
    const active = activeFilePath();
    const current = active ? store.findPackageForPath(active) : undefined;
    const recent = runner.recent.flatMap((r) => {
      const entry = store.workspaces.find((e) => e.workspace.root === r.root);
      const pkg = entry && allPackages(entry.workspace).find((p) => p.relativeDir === r.relativeDir);
      return entry && pkg && r.script in pkg.scripts
        ? scriptItems({ entry, pkg }).filter((i) => i.script === r.script)
        : [];
    });
    if (recent.length) items.push(separator(vscode.l10n.t('recently run')), ...recent);
    if (current && Object.keys(current.pkg.scripts).length) {
      items.push(separator(vscode.l10n.t('current package')), ...scriptItems(current));
    }
    for (const entry of store.workspaces) {
      for (const pkg of allPackages(entry.workspace)) {
        if (pkg === current?.pkg || Object.keys(pkg.scripts).length === 0) continue;
        items.push(separator(packageLabel(pkg)), ...scriptItems({ entry, pkg }));
      }
    }
  }
  if (!items.some((i) => i.script)) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No scripts found.'));
    return undefined;
  }
  return vscode.window.showQuickPick(items, {
    placeHolder: only
      ? vscode.l10n.t('Run a script in {0}', packageLabel(only.pkg))
      : vscode.l10n.t('Run a script (type to filter by script or package)'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
}

async function openManifestAt(pkg: WorkspacePackage, script?: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(pkg.manifestPath));
  const node = script ? findScriptNodes(document.getText()).find((s) => s.name === script) : undefined;
  const selection = node
    ? new vscode.Range(
        document.positionAt(node.key.offset),
        document.positionAt(node.key.offset + node.key.length),
      )
    : undefined;
  await vscode.window.showTextDocument(document, { selection, preview: false });
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { store, bun, runner, tree, treeView, runs, log } = deps;

  const runScript = async (arg: Arg) => {
    if (arg instanceof ScriptNode) {
      return runner.run(arg.entry, { kind: 'package', pkg: arg.pkg }, arg.name);
    }
    const picked = await pickScript(store, runner, packageFromArg(store, arg));
    if (picked?.match && picked.script) {
      return runner.run(picked.match.entry, { kind: 'package', pkg: picked.match.pkg }, picked.script);
    }
    return undefined;
  };

  const runGraph = (kind: 'withDependencies' | 'dependents') => async (arg: Arg) => {
    if (!(arg instanceof ScriptNode)) return undefined;
    return runner.run(arg.entry, { kind, pkg: arg.pkg }, arg.name);
  };

  const runScriptInAllPackages = async (scriptArg?: string) => {
    const entry = await pickWorkspace(store);
    if (!entry) return undefined;
    let script = typeof scriptArg === 'string' ? scriptArg : undefined;
    if (!script) {
      const grouped = scriptsAcrossPackages(entry.workspace);
      if (grouped.size === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No workspace package defines any scripts.'));
        return undefined;
      }
      const picked = await vscode.window.showQuickPick(
        [...grouped].map(([name, pkgs]) => ({
          label: name,
          description: vscode.l10n.t('{0} of {1} packages', pkgs.length, entry.workspace.packages.length),
          detail: pkgs.map(packageLabel).join(', '),
        })),
        { placeHolder: vscode.l10n.t('Run a script in every package that defines it'), matchOnDetail: true },
      );
      script = picked?.label;
    }
    return script ? runner.run(entry, { kind: 'all' }, script) : undefined;
  };

  const copyCommand = async (arg: Arg) => {
    if (!(arg instanceof ScriptNode)) return undefined;
    const resolved = await bun.resolve(arg.entry.workspace.root);
    const invocation = buildRunInvocation(
      arg.entry.workspace,
      arg.entry.graph,
      { kind: 'package', pkg: arg.pkg },
      arg.name,
      resolved?.version,
    );
    const text = buildCopyableCommand(invocation, process.platform, arg.pkg);
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(vscode.l10n.t('Copied: {0}', text), 3000);
    return text;
  };

  const goToPackage = async () => {
    const openButton = {
      iconPath: new vscode.ThemeIcon('folder-opened'),
      tooltip: vscode.l10n.t('Reveal in Explorer View'),
    };
    const terminalButton = {
      iconPath: new vscode.ThemeIcon('terminal'),
      tooltip: vscode.l10n.t('Open Terminal in Package'),
    };
    const items = store.workspaces.flatMap((entry) =>
      allPackages(entry.workspace).map((pkg) => ({
        label: pkg.isRoot ? `$(repo) ${packageLabel(pkg)}` : `$(package) ${packageLabel(pkg)}`,
        description: [pkg.version, pkg.relativeDir || '.'].filter(Boolean).join(' · '),
        pkg,
        buttons: [openButton, terminalButton],
      })),
    );
    const quickPick = vscode.window.createQuickPick<(typeof items)[number]>();
    quickPick.items = items;
    quickPick.matchOnDescription = true;
    quickPick.placeholder = vscode.l10n.t('Go to a package');
    return new Promise<void>((resolve) => {
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        if (selected) await openManifestAt(selected.pkg);
        resolve();
      });
      quickPick.onDidTriggerItemButton(async (e) => {
        quickPick.hide();
        if (e.button === openButton)
          await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(e.item.pkg.dir));
        else openTerminal(e.item.pkg);
        resolve();
      });
      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve();
      });
      quickPick.show();
    });
  };

  const openTerminal = (pkg: WorkspacePackage) => {
    const terminal = vscode.window.createTerminal({ name: packageLabel(pkg), cwd: pkg.dir });
    terminal.show();
    return terminal;
  };

  const revealPackage = async (match: PackageMatch | undefined, focus: boolean) => {
    const node = match && tree.findPackageNode(match.pkg.manifestPath);
    if (!node) return false;
    await treeView.reveal(node, { select: true, focus, expand: false });
    return true;
  };

  const register = (id: string, fn: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        log.error(`Command ${id} failed`, error);
        void vscode.window.showErrorMessage(
          vscode.l10n.t('Bun Companion: {0}', error instanceof Error ? error.message : String(error)),
        );
        return undefined;
      }
    });

  return [
    register('bunCompanion.runScript', runScript),
    register('bunCompanion.runScriptWithDependencies', runGraph('withDependencies')),
    register('bunCompanion.runScriptInDependents', runGraph('dependents')),
    register('bunCompanion.runScriptInAllPackages', runScriptInAllPackages),
    register('bunCompanion.copyCommand', copyCommand),
    register('bunCompanion.stopScript', (arg: Arg) => {
      if (!(arg instanceof ScriptNode)) return;
      const state = runs.get(arg.pkg.dir, arg.name);
      if (state?.kind === 'running') state.execution.terminate();
    }),
    register('bunCompanion.goToPackage', goToPackage),
    register('bunCompanion.revealActivePackage', async () => {
      const active = activeFilePath();
      const match = active ? store.findPackageForPath(active) : undefined;
      if (!(await revealPackage(match, true))) {
        void vscode.window.showInformationMessage(
          vscode.l10n.t('The active file is not inside a Bun project.'),
        );
      }
    }),
    register('bunCompanion.openTerminal', async (arg: Arg) => {
      const active = activeFilePath();
      const match = packageFromArg(store, arg) ?? (active ? store.findPackageForPath(active) : undefined);
      if (match) return openTerminal(match.pkg);
      const entry = await pickWorkspace(store);
      return entry ? openTerminal(entry.workspace.rootPackage) : undefined;
    }),
    register('bunCompanion.openPackageJson', async (arg: Arg) => {
      const match = packageFromArg(store, arg);
      if (match) await openManifestAt(match.pkg);
    }),
    register('bunCompanion.revealInExplorer', async (arg: Arg) => {
      const match = packageFromArg(store, arg);
      if (match) await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(match.pkg.dir));
    }),
    register('bunCompanion.openScript', async (arg: Arg) => {
      if (arg instanceof ScriptNode) await openManifestAt(arg.pkg, arg.name);
    }),
    register('bunCompanion.refresh', () => store.reload()),
    register('bunCompanion.viewAsTree', () =>
      vscode.workspace
        .getConfiguration('bunCompanion')
        .update('packagesView.style', 'tree', vscode.ConfigurationTarget.Global),
    ),
    register('bunCompanion.viewAsList', () =>
      vscode.workspace
        .getConfiguration('bunCompanion')
        .update('packagesView.style', 'list', vscode.ConfigurationTarget.Global),
    ),
    register('bunCompanion.selectBunPath', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: false,
        openLabel: vscode.l10n.t('Use This Bun'),
        title: vscode.l10n.t('Select the Bun executable'),
      });
      const file = picked?.[0];
      if (!file) return undefined;
      await vscode.workspace
        .getConfiguration('bunCompanion')
        .update('bunPath', file.fsPath, vscode.ConfigurationTarget.Global);
      return file.fsPath;
    }),
    register('bunCompanion.showLog', () => log.show()),
  ];
}

export function revealPackageOnEditorChange(
  deps: Pick<CommandDeps, 'store' | 'tree' | 'treeView'>,
): vscode.Disposable {
  const reveal = (editor: vscode.TextEditor | undefined) => {
    if (!deps.treeView.visible || !editor || editor.document.uri.scheme !== 'file') return;
    if (
      !vscode.workspace.getConfiguration('bunCompanion').get<boolean>('packagesView.followActiveEditor', true)
    )
      return;
    const match = deps.store.findPackageForPath(editor.document.uri.fsPath);
    const node = match && deps.tree.findPackageNode(match.pkg.manifestPath);
    if (node && deps.treeView.selection[0] !== node) {
      void deps.treeView.reveal(node, { select: true, focus: false, expand: false });
    }
  };
  return vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor(reveal),
    deps.treeView.onDidChangeVisibility((e) => {
      if (e.visible) reveal(vscode.window.activeTextEditor);
    }),
    deps.store.onDidChange(() => reveal(vscode.window.activeTextEditor)),
  );
}

export function syncHiddenCommands(): vscode.Disposable {
  let previous = new Set<string>();
  const apply = () => {
    const hidden = new Set(
      vscode.workspace.getConfiguration('bunCompanion').get<string[]>('commands.hidden', []),
    );
    for (const id of new Set([...previous, ...hidden])) {
      void vscode.commands.executeCommand(
        'setContext',
        `bunCompanion.hide.${id.replace(/^bunCompanion\./, '')}`,
        hidden.has(id),
      );
    }
    previous = hidden;
  };
  apply();
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('bunCompanion.commands.hidden')) apply();
  });
}
