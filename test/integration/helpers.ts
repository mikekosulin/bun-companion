import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BunCompanionApi } from '../../src/extension';
import type { TreeNode } from '../../src/vscode/packagesTree';

export const EXTENSION_ID = 'mikekosulin.bun-companion';

export async function getApi(): Promise<BunCompanionApi> {
  const extension = vscode.extensions.getExtension<BunCompanionApi>(EXTENSION_ID);
  if (!extension) throw new Error(`${EXTENSION_ID} is not installed`);
  const api = await extension.activate();
  await api.whenReady();
  return api;
}

export function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error('no workspace folder');
  return folder.uri.fsPath;
}

export function fixturePath(...segments: string[]): string {
  return path.join(workspaceRoot(), ...segments);
}

export async function waitFor<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  message: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export function labelOf(node: TreeNode): string {
  const label = node.toTreeItem().label;
  return typeof label === 'string' ? label : (label?.label ?? '');
}

export function findNode(api: BunCompanionApi, label: string, from?: TreeNode): TreeNode {
  for (const node of api.getTreeChildren(from)) {
    if (labelOf(node) === label) return node;
    try {
      return findNode(api, label, node);
    } catch {}
  }
  throw new Error(`tree node "${label}" not found`);
}

export function waitForTaskEnd(name: string, timeoutMs = 30_000): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`task "${name}" did not finish`));
    }, timeoutMs);
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.name !== name) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e.exitCode);
    });
  });
}

export async function openDocument(file: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  return vscode.window.showTextDocument(document);
}

export function positionOf(document: vscode.TextDocument, needle: string, delta = 1): vscode.Position {
  const index = document.getText().indexOf(needle);
  if (index < 0) throw new Error(`"${needle}" not found in ${document.uri.fsPath}`);
  return document.positionAt(index + delta);
}

export async function revertAndClose(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
