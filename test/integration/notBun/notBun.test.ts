import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { describe, it } from '../framework';
import { fixturePath, getApi, openDocument } from '../helpers';

describe('a non-Bun workspace', () => {
  it('activates quietly and finds nothing', async () => {
    const api = await getApi();
    assert.deepEqual(api.getWorkspaces(), []);
    assert.deepEqual(api.getTreeChildren(), []);
  });

  it('contributes no tasks and no diagnostics', async () => {
    const api = await getApi();
    assert.deepEqual(await vscode.tasks.fetchTasks({ type: 'bunCompanion' }), []);
    const { document } = await openDocument(fixturePath('packages', 'x', 'package.json'));
    assert.deepEqual(api.getDiagnostics(document.uri), []);
    assert.equal(api.getStatusBarText(), '');
  });
});
