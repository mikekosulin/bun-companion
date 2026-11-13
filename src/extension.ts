import * as vscode from 'vscode';
import type { BunWorkspace } from './core/types';
import { BunService } from './vscode/bun';
import { registerCommands, revealPackageOnEditorChange, syncHiddenCommands } from './vscode/commands';
import { ManifestDiagnostics, registerLanguageFeatures } from './vscode/language';
import { PackagesTreeProvider, type TreeNode } from './vscode/packagesTree';
import { ScriptRunner } from './vscode/runner';
import { RunStateTracker } from './vscode/runState';
import { PackageStatusBar } from './vscode/statusBar';
import { WorkspaceStore } from './vscode/store';
import { BunTaskProvider, TASK_TYPE } from './vscode/tasks';

export interface BunCompanionApi {
  whenReady(): Promise<void>;
  reload(): Promise<void>;
  getWorkspaces(): readonly BunWorkspace[];
  getDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[];
  getTreeChildren(node?: TreeNode): TreeNode[];
  getStatusBarText(): string | undefined;
}

export function activate(context: vscode.ExtensionContext): BunCompanionApi {
  const log = vscode.window.createOutputChannel('Bun Companion', { log: true });
  const store = new WorkspaceStore(log);
  const bun = new BunService(log);
  const runner = new ScriptRunner(bun, context.workspaceState);
  const runs = new RunStateTracker();
  const tree = new PackagesTreeProvider(store, runs);
  const treeView = vscode.window.createTreeView('bunCompanion.packages', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  const diagnostics = new ManifestDiagnostics(store);
  const statusBar = new PackageStatusBar(store);

  context.subscriptions.push(
    log,
    store,
    bun,
    tree,
    treeView,
    diagnostics,
    statusBar,
    vscode.tasks.registerTaskProvider(TASK_TYPE, new BunTaskProvider(store, bun)),
    runs,
    ...registerCommands({ store, bun, runner, tree, treeView, runs, log }),
    ...registerLanguageFeatures(store),
    revealPackageOnEditorChange({ store, tree, treeView }),
    syncHiddenCommands(),
  );

  void store.start();

  return {
    whenReady: () => store.whenReady(),
    reload: () => store.reload(),
    getWorkspaces: () => store.workspaces.map((e) => e.workspace),
    getDiagnostics: (uri) => diagnostics.get(uri),
    getTreeChildren: (node) => tree.getChildren(node),
    getStatusBarText: () => statusBar.text,
  };
}

export function deactivate(): void {}
