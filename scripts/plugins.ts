import * as path from 'node:path';

const root = path.resolve(import.meta.dir, '..');

export const preferEsm: Bun.BunPlugin = {
  name: 'prefer-esm',
  setup(build) {
    build.onResolve({ filter: /^jsonc-parser$/ }, () => ({
      path: path.join(root, 'node_modules/jsonc-parser/lib/esm/main.js'),
    }));
  },
};

export const bunTestOnNode: Bun.BunPlugin = {
  name: 'bun-test-on-node',
  setup(build) {
    build.onResolve({ filter: /^bun:test$/ }, () => ({
      path: path.join(root, 'test/node/bun-test-shim.ts'),
    }));
  },
};
