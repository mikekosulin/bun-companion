import * as vscode from 'vscode';
import { packageLabel } from '../core/types';
import type { WorkspaceStore } from './store';

export class PackageStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'bunCompanion.package',
    vscode.StatusBarAlignment.Left,
    50,
  );
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly store: WorkspaceStore) {
    this.item.name = vscode.l10n.t('Bun Companion: Current Package');
    this.disposables = [
      this.item,
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      store.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('bunCompanion.statusBar')) this.update();
      }),
    ];
    this.update();
  }

  update(): void {
    const enabled = vscode.workspace.getConfiguration('bunCompanion').get<boolean>('statusBar.enabled', true);
    const uri = vscode.window.activeTextEditor?.document.uri;
    const match = enabled && uri?.scheme === 'file' ? this.store.findPackageForPath(uri.fsPath) : undefined;
    if (!match) {
      this.item.hide();
      return;
    }
    const label = packageLabel(match.pkg);
    this.item.text = `$(package) ${label}`;
    this.item.tooltip = vscode.l10n.t('Run a script in {0}', label);
    this.item.command = {
      command: 'bunCompanion.runScript',
      title: vscode.l10n.t('Run Script…'),
      arguments: [vscode.Uri.file(match.pkg.manifestPath)],
    };
    this.item.show();
  }

  get text(): string | undefined {
    return this.item.text;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
