import { join } from 'node:path';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

delete process.env.ELECTRON_RUN_AS_NODE;

const root = join(import.meta.dirname, '..');
const suites = {
  basic: 'test/fixtures/basic',
  single: 'test/fixtures/single',
  multiRoot: 'test/fixtures/multi-root.code-workspace',
  notBun: 'test/fixtures/not-bun',
};
const only = process.argv.slice(2);
const version = process.env.VSCODE_TEST_VERSION ?? 'stable';
const vscodeExecutablePath = await downloadAndUnzipVSCode(version);

let failed = false;
for (const [name, workspace] of Object.entries(suites)) {
  if (only.length > 0 && !only.includes(name)) continue;
  console.log(`\n▶ ${name} (VS Code ${version})`);
  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'out/test/integration', name, 'suite.js'),
      launchArgs: [join(root, workspace), '--disable-extensions', '--disable-workspace-trust'],
    });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
