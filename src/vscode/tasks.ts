import * as vscode from 'vscode';
import { buildCopyableCommand, buildRunInvocation, type RunInvocation } from '../core/commands';
import { allPackages, packageLabel, type WorkspacePackage } from '../core/types';
import type { BunService } from './bun';
import type { WorkspaceEntry, WorkspaceStore } from './store';

export const TASK_TYPE = 'bunCompanion';
export const TASK_SOURCE = 'Bun Companion';

export interface BunTaskDefinition extends vscode.TaskDefinition {
  readonly type: typeof TASK_TYPE;
  readonly script: string;
  readonly package?: string;
  readonly filter?: readonly string[];
}

const GROUPS: Record<string, vscode.TaskGroup> = {
  build: vscode.TaskGroup.Build,
  test: vscode.TaskGroup.Test,
  clean: vscode.TaskGroup.Clean,
};

export function createTask(
  entry: WorkspaceEntry,
  invocation: RunInvocation,
  definition: BunTaskDefinition,
  bunPath: string,
  pkg?: WorkspacePackage,
): vscode.Task {
  const task = new vscode.Task(
    definition,
    entry.folder,
    invocation.label,
    TASK_SOURCE,
    // No shell: args reach bun verbatim, and npm's bun.cmd shim is never involved on Windows.
    new vscode.ProcessExecution(bunPath, [...invocation.args], { cwd: invocation.cwd }),
    [],
  );
  task.detail = buildCopyableCommand(invocation, process.platform, pkg);
  const group = GROUPS[definition.script];
  if (group) task.group = group;
  return task;
}

export function definitionFor(
  pkg: WorkspacePackage | undefined,
  script: string,
  invocation: RunInvocation,
): BunTaskDefinition {
  return invocation.filters.length > 0 || !pkg
    ? { type: TASK_TYPE, script, filter: invocation.filters }
    : { type: TASK_TYPE, script, package: pkg.relativeDir };
}

export class BunTaskProvider implements vscode.TaskProvider {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly bun: BunService,
  ) {}

  async provideTasks(): Promise<vscode.Task[]> {
    await this.store.whenReady();
    const tasks: vscode.Task[] = [];
    for (const entry of this.store.workspaces) {
      const bun = await this.bun.resolve(entry.workspace.root);
      for (const pkg of allPackages(entry.workspace)) {
        for (const script of Object.keys(pkg.scripts)) {
          const invocation = buildRunInvocation(
            entry.workspace,
            entry.graph,
            { kind: 'package', pkg },
            script,
            bun?.version,
          );
          tasks.push(
            createTask(entry, invocation, definitionFor(pkg, script, invocation), bun?.path ?? 'bun', pkg),
          );
        }
      }
    }
    return tasks;
  }

  async resolveTask(task: vscode.Task): Promise<vscode.Task | undefined> {
    const definition = task.definition as BunTaskDefinition;
    if (definition.type !== TASK_TYPE || typeof definition.script !== 'string') return undefined;
    await this.store.whenReady();
    const folder = typeof task.scope === 'object' ? task.scope : undefined;
    const entry =
      this.store.workspaces.find(
        (e) => e.folder === folder || (folder && e.folder.uri.toString() === folder.uri.toString()),
      ) ?? this.store.workspaces[0];
    if (!entry) return undefined;
    const bun = await this.bun.resolve(entry.workspace.root);
    const bunPath = bun?.path ?? 'bun';

    if (definition.filter && definition.filter.length > 0) {
      const filters = [...definition.filter];
      const invocation: RunInvocation = {
        cwd: entry.workspace.root,
        args: ['run', ...filters.flatMap((f) => ['--filter', f]), definition.script],
        label: `${filters.join(' ')} › ${definition.script}`,
        filters,
      };
      return createTask(entry, invocation, definition, bunPath);
    }

    const wanted = definition.package ?? '';
    const pkg = allPackages(entry.workspace).find((p) => p.relativeDir === wanted || p.name === wanted);
    if (!pkg) return undefined;
    const invocation = buildRunInvocation(
      entry.workspace,
      entry.graph,
      { kind: 'package', pkg },
      definition.script,
      bun?.version,
    );
    return createTask(
      entry,
      { ...invocation, label: `${packageLabel(pkg)} › ${definition.script}` },
      definition,
      bunPath,
      pkg,
    );
  }
}
