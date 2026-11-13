import * as assert from 'node:assert/strict';
import { describe, it } from '../framework';
import { getApi, labelOf } from '../helpers';

describe('multi-root window', () => {
  it('discovers a Bun workspace in every folder', async () => {
    const api = await getApi();
    const roots = api.getWorkspaces().map((w) => w.rootPackage.name);
    assert.deepEqual(roots, ['fixture-basic', 'fixture-second']);
    assert.equal(api.getWorkspaces()[1]?.detectedBy, 'packageManager');
  });

  it('shows one top-level node per workspace', async () => {
    const api = await getApi();
    const top = api.getTreeChildren();
    assert.deepEqual(top.map(labelOf), ['fixture-basic', 'fixture-second']);
    assert.deepEqual(api.getTreeChildren(top[1]).map(labelOf), ['fixture-second', 'second-a']);
  });
});
