const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const stub = () =>
  new Proxy(() => {}, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : stub()),
    construct: () => stub(),
    apply: () => stub(),
  });

const typings = fs.readFileSync(require.resolve('@types/vscode/index.d.ts'), 'utf8');
const vscodeExports = Object.fromEntries(
  [...typings.matchAll(/^\s*export (?:namespace|class|enum|const|let|function) (\w+)/gm)].map(([, name]) => [
    name,
    stub(),
  ]),
);

const original = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') return vscodeExports;
  return original.call(this, request, ...rest);
};

try {
  const bundle = require(path.join(__dirname, '..', 'dist', 'extension.js'));
  for (const name of ['activate', 'deactivate']) {
    if (typeof bundle[name] !== 'function') throw new Error(`does not export ${name}()`);
  }
  console.log(`dist/extension.js loads under Node ${process.version}`);
} catch (error) {
  console.error(`dist/extension.js failed to load under Node ${process.version}: ${error.message}`);
  process.exit(1);
}
