import * as path from 'node:path';
import * as vscode from 'vscode';
import { WorkspaceGraph } from '../core/graph';
import { isInside } from '../core/paths';
import { allPackages, type BunWorkspace, type WorkspacePackage } from '../core/types';
import { findWorkspaceRoots, loadWorkspace } from '../core/workspace';

export interface WorkspaceEntry {
  readonly workspace: BunWorkspace;
  readonly graph: WorkspaceGraph;
  readonly folder: vscode.WorkspaceFolder;
}

export interface PackageMatch {
  readonly entry: WorkspaceEntry;
  readonly pkg: WorkspacePackage;
}

export type StoreState = 'loading' | 'ready';

const WATCH_GLOB = '**/{package.json,bun.lock,bun.lockb,bunfig.toml}';
const NODE_MODULES = `${path.sep}node_modules${path.sep}`;

export class WorkspaceStore implements vscode.Disposable {
  private entries: WorkspaceEntry[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private watchers = new Map<string, vscode.Disposable>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private firstLoad: Promise<void> | undefined;
  private currentState: StoreState = 'loading';

  constructor(
    private readonly log: vscode.LogOutputChannel,
    private readonly debounceMs = 200,
  ) {}

  get state(): StoreState {
    return this.currentState;
  }

  get workspaces(): readonly WorkspaceEntry[] {
    return this.entries;
  }

  start(): Promise<void> {
    void vscode.commands.executeCommand('setContext', 'bunCompanion.state', 'loading');
    this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReload()));
    this.firstLoad = this.reload();
    return this.firstLoad;
  }

  whenReady(): Promise<void> {
    return this.firstLoad ?? Promise.resolve();
  }

  reload(): Promise<void> {
    this.queue = this.queue.then(
      () => this.load(),
      () => this.load(),
    );
    return this.queue;
  }

  scheduleReload(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.reload();
    }, this.debounceMs);
  }

  private async load(): Promise<void> {
    const started = Date.now();
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
    const entries: WorkspaceEntry[] = [];
    const seen = new Set<string>();
    try {
      for (const folder of folders) {
        for (const root of await findWorkspaceRoots(folder.uri.fsPath)) {
          if (seen.has(root)) continue;
          seen.add(root);
          const workspace = await loadWorkspace(root);
          if (workspace) entries.push({ workspace, graph: new WorkspaceGraph(workspace), folder });
        }
      }
    } catch (error) {
      this.log.error('Failed to load Bun workspaces', error);
    }

    this.entries = entries;
    this.updateWatchers(folders);
    this.currentState = 'ready';
    await vscode.commands.executeCommand('setContext', 'bunCompanion.hasWorkspace', entries.length > 0);
    await vscode.commands.executeCommand('setContext', 'bunCompanion.state', 'ready');
    for (const { workspace } of entries) {
      this.log.info(
        `Loaded ${workspace.root}: ${workspace.packages.length} packages, detected by ${workspace.detectedBy}` +
          (workspace.problems.length ? `, ${workspace.problems.length} problems` : ''),
      );
    }
    this.log.debug(`Workspace discovery took ${Date.now() - started} ms`);
    this.changeEmitter.fire();
  }

  private updateWatchers(folders: readonly vscode.WorkspaceFolder[]): void {
    const bases = new Set(folders.map((f) => f.uri.fsPath));
    for (const { workspace } of this.entries) {
      if (![...bases].some((b) => isInside(b, workspace.root))) bases.add(workspace.root);
    }
    for (const [base, watcher] of this.watchers) {
      if (!bases.has(base)) {
        watcher.dispose();
        this.watchers.delete(base);
      }
    }
    for (const base of bases) {
      if (this.watchers.has(base)) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(base), WATCH_GLOB),
      );
      const onEvent = (uri: vscode.Uri) => {
        if (!uri.fsPath.includes(NODE_MODULES)) this.scheduleReload();
      };
      watcher.onDidCreate(onEvent);
      watcher.onDidChange(onEvent);
      watcher.onDidDelete(onEvent);
      // Deleting a package folder emits one event for the folder, not for its package.json.
      const deletions = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(base), '**'),
        true,
        true,
        false,
      );
      deletions.onDidDelete((uri) => {
        if (this.containsPackage(uri.fsPath)) this.scheduleReload();
      });
      this.watchers.set(base, vscode.Disposable.from(watcher, deletions));
    }
  }

  private containsPackage(fsPath: string): boolean {
    return this.entries.some((e) => allPackages(e.workspace).some((p) => isInside(fsPath, p.dir)));
  }

  findEntryForPath(fsPath: string): WorkspaceEntry | undefined {
    return this.entries
      .filter((e) => isInside(e.workspace.root, fsPath))
      .sort((a, b) => b.workspace.root.length - a.workspace.root.length)[0];
  }

  findPackageForPath(fsPath: string): PackageMatch | undefined {
    let best: PackageMatch | undefined;
    for (const entry of this.entries) {
      for (const pkg of allPackages(entry.workspace)) {
        if (isInside(pkg.dir, fsPath) && (!best || pkg.dir.length > best.pkg.dir.length))
          best = { entry, pkg };
      }
    }
    return best;
  }

  findPackageByManifest(fsPath: string): PackageMatch | undefined {
    const target = path.resolve(fsPath);
    for (const entry of this.entries) {
      for (const pkg of allPackages(entry.workspace)) {
        if (path.resolve(pkg.manifestPath) === target) return { entry, pkg };
      }
    }
    return undefined;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const w of this.watchers.values()) w.dispose();
    this.watchers.clear();
    for (const d of this.disposables) d.dispose();
  }
}
