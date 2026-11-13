import * as vscode from 'vscode';
import { buildRunInvocation, type RunTarget } from '../core/commands';
import type { WorkspacePackage } from '../core/types';
import type { BunService } from './bun';
import type { WorkspaceEntry } from './store';
import { createTask, definitionFor } from './tasks';

export interface RecentRun {
  readonly root: string;
  readonly relativeDir: string;
  readonly script: string;
}

const RECENT_KEY = 'bunCompanion.recentRuns';
const RECENT_LIMIT = 5;

export class ScriptRunner {
  constructor(
    private readonly bun: BunService,
    private readonly state: vscode.Memento,
  ) {}

  get recent(): readonly RecentRun[] {
    return this.state.get<RecentRun[]>(RECENT_KEY, []);
  }

  async run(
    entry: WorkspaceEntry,
    target: RunTarget,
    script: string,
  ): Promise<vscode.TaskExecution | undefined> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Scripts can only be run in a trusted workspace.'));
      return undefined;
    }
    const bun = await this.bun.require(entry.workspace.root);
    if (!bun) return undefined;
    const invocation = buildRunInvocation(entry.workspace, entry.graph, target, script, bun.version);
    const pkg: WorkspacePackage | undefined = target.kind === 'package' ? target.pkg : undefined;
    const task = createTask(entry, invocation, definitionFor(pkg, script, invocation), bun.path, pkg);
    if (pkg) await this.remember({ root: entry.workspace.root, relativeDir: pkg.relativeDir, script });
    return vscode.tasks.executeTask(task);
  }

  private async remember(run: RecentRun): Promise<void> {
    const same = (r: RecentRun) =>
      r.root === run.root && r.relativeDir === run.relativeDir && r.script === run.script;
    await this.state.update(RECENT_KEY, [run, ...this.recent.filter((r) => !same(r))].slice(0, RECENT_LIMIT));
  }
}
