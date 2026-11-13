import * as path from 'node:path';
import * as vscode from 'vscode';
import { TASK_TYPE } from './tasks';

export type RunState =
  | { readonly kind: 'running'; readonly execution: vscode.TaskExecution; readonly startedAt: number }
  | { readonly kind: 'done'; readonly exitCode: number | undefined; readonly durationMs: number };

export function runKey(cwd: string, script: string): string {
  return `${path.resolve(cwd)}\u0000${script}`;
}

function keyOf(execution: vscode.TaskExecution): string | undefined {
  const { task } = execution;
  if (task.definition.type !== TASK_TYPE || task.definition.filter?.length) return undefined;
  const cwd = task.execution instanceof vscode.ProcessExecution ? task.execution.options?.cwd : undefined;
  return cwd ? runKey(cwd, String(task.definition.script)) : undefined;
}

export class RunStateTracker implements vscode.Disposable {
  private readonly states = new Map<string, RunState>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.disposables = [
      this.changeEmitter,
      vscode.tasks.onDidStartTaskProcess((e) => {
        const key = keyOf(e.execution);
        if (!key) return;
        this.states.set(key, { kind: 'running', execution: e.execution, startedAt: Date.now() });
        this.changeEmitter.fire();
      }),
      vscode.tasks.onDidEndTaskProcess((e) => {
        const key = keyOf(e.execution);
        const previous = key ? this.states.get(key) : undefined;
        if (!key) return;
        const startedAt = previous?.kind === 'running' ? previous.startedAt : Date.now();
        this.states.set(key, { kind: 'done', exitCode: e.exitCode, durationMs: Date.now() - startedAt });
        this.changeEmitter.fire();
      }),
    ];
  }

  get(cwd: string, script: string): RunState | undefined {
    return this.states.get(runKey(cwd, script));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
