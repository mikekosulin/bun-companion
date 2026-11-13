import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BunCompanionApi } from '../../../src/extension';
import type { TreeNode } from '../../../src/vscode/packagesTree';
import { afterEach, before, describe, it } from '../framework';
import {
  findNode,
  fixturePath,
  getApi,
  labelOf,
  openDocument,
  positionOf,
  revertAndClose,
  waitFor,
  waitForTaskEnd,
} from '../helpers';

function bunSupportsGraphFilters(): boolean {
  const [major = 0, minor = 0] = execFileSync('bun', ['--version'], { encoding: 'utf8' })
    .split('.')
    .map(Number);
  return major > 1 || (major === 1 && minor >= 4);
}

describe('basic Bun workspace', () => {
  let api: BunCompanionApi;

  before(async () => {
    api = await getApi();
  });

  afterEach(async () => {
    await revertAndClose();
  });

  describe('discovery', () => {
    it('finds the workspace, its packages and catalogs', () => {
      const [ws] = api.getWorkspaces();
      assert.ok(ws);
      assert.equal(ws.rootPackage.name, 'fixture-basic');
      assert.equal(ws.detectedBy, 'bun.lock');
      assert.deepEqual(
        ws.packages.map((p) => p.name),
        ['web', '@fx/core', '@fx/ui'],
      );
      assert.equal(ws.catalogs.get('default')?.get('react'), '^19.2.0');
      assert.deepEqual(ws.problems, []);
    });

    it('picks up new and removed packages through the file watcher', async () => {
      const dir = fixturePath('packages', 'added');
      await mkdir(dir, { recursive: true });
      try {
        const appeared = () => api.getWorkspaces()[0]?.packages.some((p) => p.name === '@fx/added');
        // The OS watcher may still be starting right after launch on slow CI runners: rewrite and retry.
        for (let attempt = 1; ; attempt++) {
          await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@fx/added', attempt }));
          try {
            await waitFor(appeared, 'new package to appear', 5_000);
            break;
          } catch (error) {
            if (attempt === 4) throw error;
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      await waitFor(
        () => api.getWorkspaces()[0]?.packages.every((p) => p.name !== '@fx/added'),
        'removed package to disappear',
      );
    });
  });

  describe('packages view', () => {
    const rootLabels = () => api.getTreeChildren().map(labelOf);
    const iconOf = (node: TreeNode | undefined) =>
      (node?.toTreeItem().iconPath as vscode.ThemeIcon | undefined)?.id;

    it('groups packages by folder when they live in several folders', () => {
      assert.deepEqual(rootLabels(), ['fixture-basic', 'apps', 'packages']);
      const packages = api.getTreeChildren().find((n) => labelOf(n) === 'packages') as TreeNode;
      assert.deepEqual(api.getTreeChildren(packages).map(labelOf), ['@fx/core', '@fx/ui']);
    });

    it('uses one package icon, the version as description and "root" for the root', () => {
      const root = api.getTreeChildren()[0]?.toTreeItem();
      assert.equal(root?.description, 'root');
      assert.equal((root?.iconPath as vscode.ThemeIcon | undefined)?.id, 'package');
      const core = findNode(api, '@fx/core').toTreeItem();
      assert.equal(core.description, '1.0.0');
      assert.equal((core.iconPath as vscode.ThemeIcon).id, 'package');
    });

    it('shows script names only, folds pre/post hooks into their script', () => {
      const scripts = api.getTreeChildren(findNode(api, '@fx/core'));
      assert.deepEqual(scripts.map(labelOf), ['build', 'hello', 'fail', 'wait']);
      const item = scripts[1]?.toTreeItem();
      assert.equal(item?.description, undefined);
      assert.equal(item?.contextValue, 'script');
      assert.equal(item?.command?.command, 'bunCompanion.openScript');
      assert.match(
        (item?.tooltip as vscode.MarkdownString | undefined)?.value ?? '',
        /prehello[\s\S]*echo pre[\s\S]*echo hello/,
      );
    });

    it('switches to a flat list from the settings', async () => {
      const config = vscode.workspace.getConfiguration('bunCompanion');
      await config.update('packagesView.style', 'list', vscode.ConfigurationTarget.Workspace);
      try {
        await waitFor(() => rootLabels().includes('web'), 'flat list');
        assert.deepEqual(rootLabels(), ['fixture-basic', 'web', '@fx/core', '@fx/ui']);
      } finally {
        await config.update('packagesView.style', undefined, vscode.ConfigurationTarget.Workspace);
      }
      await waitFor(() => rootLabels().includes('packages'), 'folders again');
    });

    it('shows the result of the last run on the script', async () => {
      const [, hello, fail] = api.getTreeChildren(findNode(api, '@fx/core'));
      const ok = waitForTaskEnd('@fx/core › hello');
      await vscode.commands.executeCommand('bunCompanion.runScript', hello);
      assert.equal(await ok, 0);
      await waitFor(() => iconOf(hello) === 'pass', 'pass icon');

      const failed = waitForTaskEnd('@fx/core › fail');
      await vscode.commands.executeCommand('bunCompanion.runScript', fail);
      assert.equal(await failed, 3);
      await waitFor(() => iconOf(fail) === 'error', 'error icon');
      assert.equal(fail?.toTreeItem().description, 'exit 3');
    });

    it('stops a running script from the tree', async () => {
      const wait = api.getTreeChildren(findNode(api, '@fx/core'))[3];
      const ended = waitForTaskEnd('@fx/core › wait');
      await vscode.commands.executeCommand('bunCompanion.runScript', wait);
      await waitFor(() => wait?.toTreeItem().contextValue === 'script:running', 'running state');
      assert.equal(iconOf(wait), 'loading~spin');
      await vscode.commands.executeCommand('bunCompanion.stopScript', wait);
      assert.notEqual(await ended, 0);
      await waitFor(() => wait?.toTreeItem().contextValue === 'script', 'idle again');
    });
  });

  describe('running scripts', () => {
    it('exposes every script as a task', async () => {
      const tasks = await vscode.tasks.fetchTasks({ type: 'bunCompanion' });
      const names = tasks.map((t) => t.name).sort();
      assert.ok(names.includes('@fx/core › hello'));
      assert.ok(names.includes('fixture-basic › root-script'));
      const hello = tasks.find((t) => t.name === '@fx/core › hello');
      assert.deepEqual(hello?.definition, {
        type: 'bunCompanion',
        script: 'hello',
        package: 'packages/core',
      });
      assert.equal(hello?.detail, 'bun run --filter @fx/core hello');
      assert.equal(tasks.find((t) => t.name === '@fx/core › build')?.group?.id, vscode.TaskGroup.Build.id);
    });

    it('runs a script with its dependencies through bun --filter', async () => {
      const web = findNode(api, 'web');
      const build = api.getTreeChildren(web).find((n) => labelOf(n) === 'build');
      const started = new Promise<vscode.Task>((resolve) => {
        const sub = vscode.tasks.onDidStartTask((e) => {
          sub.dispose();
          resolve(e.execution.task);
        });
      });
      const ended = waitForTaskEnd('web... › build');
      await vscode.commands.executeCommand('bunCompanion.runScriptWithDependencies', build);
      const task = await started;
      const expected = bunSupportsGraphFilters() ? ['web...'] : ['web', '@fx/core', '@fx/ui'];
      assert.deepEqual(task.definition.filter, expected);
      assert.equal(await ended, 0);
    });

    it('runs tasks written in tasks.json', async () => {
      const dir = fixturePath('.vscode');
      await mkdir(dir, { recursive: true });
      const tasksJson = {
        version: '2.0.0',
        tasks: [
          { type: 'bunCompanion', script: 'hello', package: '@fx/core', label: 'core hello from tasks.json' },
        ],
      };
      await writeFile(path.join(dir, 'tasks.json'), JSON.stringify(tasksJson));
      try {
        const ended = waitForTaskEnd('core hello from tasks.json');
        await waitFor(async () => {
          const tasks = await vscode.tasks.fetchTasks({ type: 'bunCompanion' });
          return tasks.find((t) => t.name === 'core hello from tasks.json');
        }, 'tasks.json task to be picked up');
        await vscode.commands.executeCommand('workbench.action.tasks.runTask', 'core hello from tasks.json');
        assert.equal(await ended, 0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('copies a command that works from the root', async () => {
      const core = findNode(api, '@fx/core');
      const [build] = api.getTreeChildren(core);
      await vscode.commands.executeCommand('bunCompanion.copyCommand', build);
      assert.equal(await vscode.env.clipboard.readText(), 'bun run --filter @fx/core build');
    });
  });

  describe('editor integration', () => {
    const webManifest = () => fixturePath('apps', 'web', 'package.json');

    it('opens a script definition in package.json', async () => {
      const core = findNode(api, '@fx/core');
      const [, hello] = api.getTreeChildren(core);
      await vscode.commands.executeCommand('bunCompanion.openScript', hello);
      const editor = vscode.window.activeTextEditor;
      assert.equal(editor?.document.uri.fsPath, fixturePath('packages', 'core', 'package.json'));
      assert.equal(editor?.document.getText(editor.selection), 'hello');
    });

    it('shows the active file package in the status bar', async () => {
      await openDocument(fixturePath('apps', 'web', 'src', 'index.ts'));
      await waitFor(() => api.getStatusBarText() === '$(package) web', 'status bar');
    });

    it('goes to the definition of workspace: and catalog: dependencies', async () => {
      const { document } = await openDocument(webManifest());
      const toWorkspace = await vscode.commands.executeCommand<vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        positionOf(document, 'workspace:^'),
      );
      assert.ok(
        toWorkspace.some((l) => l.targetUri.fsPath === fixturePath('packages', 'ui', 'package.json')),
      );

      const toCatalog = await vscode.commands.executeCommand<vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        positionOf(document, 'catalog:testing'),
      );
      const link = toCatalog.find((l) => l.targetUri.fsPath === fixturePath('package.json'));
      assert.ok(link);
      const rootDoc = await vscode.workspace.openTextDocument(link.targetUri);
      assert.equal(rootDoc.getText(link.targetRange), 'vitest');
    });

    it('goes from catalog: in root overrides to the catalog entry', async () => {
      const { document } = await openDocument(fixturePath('package.json'));
      const links = await vscode.commands.executeCommand<vscode.LocationLink[]>(
        'vscode.executeDefinitionProvider',
        document.uri,
        positionOf(document, '"react": "catalog:"', 12),
      );
      const [link] = links;
      assert.ok(link);
      assert.equal(document.getText(link.targetRange), 'react');
      assert.ok(link.targetRange.start.line < positionOf(document, '"overrides"').line);
    });

    it('explains workspace dependencies on hover', async () => {
      const { document } = await openDocument(webManifest());
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        positionOf(document, '"@fx/ui"', 2),
      );
      const text = hovers
        .flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)))
        .join('\n');
      assert.match(text, /@fx\/ui/);
      assert.match(text, /packages\/ui/);
    });

    it('completes workspace: and catalog: specs', async () => {
      const editor = await openDocument(webManifest());
      const position = positionOf(editor.document, 'workspace:^', 0);
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        editor.document.uri,
        position,
      );
      const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
      assert.ok(labels.includes('workspace:*'), labels.join(', '));
    });

    it('reports a misspelled workspace package and offers a quick fix', async () => {
      const editor = await openDocument(webManifest());
      const start = positionOf(editor.document, '"@fx/ui"', 1);
      await editor.edit((b) => b.replace(new vscode.Range(start, start.translate(0, 6)), '@fx/uu'));
      const diagnostics = await waitFor(() => {
        const found = vscode.languages
          .getDiagnostics(editor.document.uri)
          .filter((d) => d.code === 'unknown-workspace-package');
        return found.length ? found : undefined;
      }, 'diagnostic');
      assert.match(diagnostics[0]?.message ?? '', /Did you mean "@fx\/ui"/);

      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        editor.document.uri,
        diagnostics[0]?.range,
      );
      const fix = actions.find((a) => a.title === 'Change to "@fx/ui"');
      assert.ok(fix?.edit);
      await vscode.workspace.applyEdit(fix.edit);
      await waitFor(
        () => vscode.languages.getDiagnostics(editor.document.uri).every((d) => d.source !== 'Bun Companion'),
        'diagnostic to clear after the quick fix',
      );
    });
  });
});
