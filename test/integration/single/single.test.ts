import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { afterEach, describe, it } from '../framework';
import {
  fixturePath,
  getApi,
  labelOf,
  openDocument,
  revertAndClose,
  waitFor,
  waitForTaskEnd,
} from '../helpers';

describe('a single-package Bun project', () => {
  afterEach(revertAndClose);

  it('is discovered without a workspaces field', async () => {
    const api = await getApi();
    const [project] = api.getWorkspaces();
    assert.equal(project?.rootPackage.name, 'fixture-single');
    assert.deepEqual(project?.packages, []);
    assert.deepEqual(project?.patterns, []);
  });

  it('shows the root package with its scripts and runs them', async () => {
    const api = await getApi();
    const [root] = api.getTreeChildren();
    assert.ok(root);
    assert.equal(labelOf(root), 'fixture-single');
    const scripts = api.getTreeChildren(root);
    assert.deepEqual(scripts.map(labelOf), ['hello', 'start']);
    const ended = waitForTaskEnd('fixture-single › hello');
    await vscode.commands.executeCommand('bunCompanion.runScript', scripts[0]);
    assert.equal(await ended, 0);
  });

  it('shows the project in the status bar', async () => {
    const api = await getApi();
    await openDocument(fixturePath('src', 'index.ts'));
    await waitFor(() => api.getStatusBarText() === '$(package) fixture-single', 'status bar');
  });
});
