import * as vscode from 'vscode';
import { type BunLocation, locateBun, readBunVersion } from '../core/bunBinary';
import { formatVersion, type Version } from '../core/version';

export interface ResolvedBun extends BunLocation {
  readonly version: Version | undefined;
}

const INSTALL_URL = 'https://bun.com/docs/installation';

export class BunService implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<ResolvedBun | undefined>>();
  private readonly warnedInvalid = new Set<string>();
  private readonly subscription: vscode.Disposable;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('bunCompanion.bunPath') || e.affectsConfiguration('bun.runtime'))
        this.cache.clear();
    });
  }

  resolve(root: string): Promise<ResolvedBun | undefined> {
    let pending = this.cache.get(root);
    if (!pending) {
      pending = this.locate(root);
      this.cache.set(root, pending);
      void pending.then((r) => {
        if (!r) this.cache.delete(root);
      });
    }
    return pending;
  }

  async require(root: string): Promise<ResolvedBun | undefined> {
    const resolved = await this.resolve(root);
    if (resolved) return resolved;
    const select = vscode.l10n.t('Select Bun Executable…');
    const install = vscode.l10n.t('How to Install Bun');
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('Bun was not found. Install it, or point Bun Companion at the executable.'),
      select,
      install,
    );
    if (choice === select) await vscode.commands.executeCommand('bunCompanion.selectBunPath');
    if (choice === install) await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
    return undefined;
  }

  private async locate(root: string): Promise<ResolvedBun | undefined> {
    const scope = vscode.Uri.file(root);
    const result = await locateBun({
      configuredPath: vscode.workspace.getConfiguration('bunCompanion', scope).get<string>('bunPath'),
      officialRuntime: vscode.workspace.getConfiguration('bun', scope).get<string>('runtime'),
      workspaceRoot: root,
    });
    if (result.invalidSetting && !this.warnedInvalid.has(result.invalidSetting)) {
      this.warnedInvalid.add(result.invalidSetting);
      const fallback = result.location?.path;
      this.log.warn(`bunCompanion.bunPath "${result.invalidSetting}" is not an executable`);
      void vscode.window.showWarningMessage(
        fallback
          ? vscode.l10n.t(
              '"bunCompanion.bunPath" ({0}) is not an executable. Using {1} instead.',
              result.invalidSetting,
              fallback,
            )
          : vscode.l10n.t('"bunCompanion.bunPath" ({0}) is not an executable.', result.invalidSetting),
      );
    }
    if (!result.location) {
      this.log.warn('Bun executable not found');
      return undefined;
    }
    const version = await readBunVersion(result.location.path);
    this.log.info(
      `Using bun ${version ? formatVersion(version) : '(unknown version)'} at ${result.location.path} (${result.location.source})`,
    );
    return { ...result.location, version };
  }

  dispose(): void {
    this.subscription.dispose();
    this.cache.clear();
  }
}
