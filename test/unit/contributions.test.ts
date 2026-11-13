import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

function findRepoRoot(start: string): string {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'package.nls.json'))) return dir;
    if (path.dirname(dir) === dir) throw new Error('repository root not found');
  }
}

const root = findRepoRoot(import.meta.dirname);
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

interface Command {
  command: string;
  title: string;
  category?: string;
  enablement?: string;
}
interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

const manifest = JSON.parse(read('package.json'));
const nls: Record<string, string> = JSON.parse(read('package.nls.json'));
const contributes = manifest.contributes;
const commands: Command[] = contributes.commands;
const commandIds = new Set(commands.map((c) => c.command));
const menus: Record<string, MenuItem[]> = contributes.menus;
const sources = [
  'src/vscode/commands.ts',
  'src/vscode/packagesTree.ts',
  'src/vscode/statusBar.ts',
  'src/vscode/bun.ts',
]
  .map(read)
  .join('\n');

function nlsKeys(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(/^%(.+)%$/g)].map((m) => m[1] as string);
  if (Array.isArray(value)) return value.flatMap(nlsKeys);
  if (value && typeof value === 'object') return Object.values(value).flatMap(nlsKeys);
  return [];
}

describe('package.json contributions', () => {
  test('identity and publishing metadata', () => {
    expect(manifest.publisher).toBe('mikekosulin');
    expect(manifest.name).toBe('bun-companion');
    expect(manifest.main).toBe('./dist/extension.js');
    expect(manifest.repository.url).toContain('github.com/mikekosulin/bun-companion');
    expect(manifest.engines.vscode).toMatch(/^\^1\.\d+\.0$/);
    expect(manifest.dependencies ? Object.keys(manifest.dependencies).length : 0).toBeGreaterThan(0);
  });

  test('every %key% is translated and every translation is used', () => {
    const used = new Set(nlsKeys(manifest));
    expect([...used].filter((k) => !(k in nls))).toEqual([]);
    expect(Object.keys(nls).filter((k) => !used.has(k))).toEqual([]);
  });

  test('every command has a title, the Bun Companion category and is registered in code', () => {
    for (const command of commands) {
      expect(command.title).toMatch(/^%command\./);
      expect(command.category).toBe('Bun Companion');
      expect(sources).toContain(`'${command.command}'`);
    }
  });

  test('commands that run scripts require a trusted workspace', () => {
    for (const command of commands.filter((c) => c.command.startsWith('bunCompanion.run'))) {
      expect(command.enablement).toBe('isWorkspaceTrusted');
    }
  });

  test('menus only reference contributed commands', () => {
    for (const items of Object.values(menus)) {
      for (const item of items) expect(commandIds.has(item.command)).toBe(true);
    }
  });

  test('every command appears in the command palette menu with an explicit when clause', () => {
    const palette = new Set(menus.commandPalette?.map((m) => m.command));
    expect(
      [...commandIds].filter(
        (id) => !palette.has(id) && !['bunCompanion.selectBunPath', 'bunCompanion.showLog'].includes(id),
      ),
    ).toEqual([]);
  });

  test('view menus target the packages view and known context values', () => {
    const contextValues = ['script', 'script:root', 'package', 'package:root'];
    for (const item of menus['view/item/context'] ?? []) {
      expect(item.when).toContain('view == bunCompanion.packages');
      const match = /viewItem (?:==|=~) \/?\^?([\w:]+)/.exec(item.when ?? '');
      expect(match).not.toBeNull();
      expect(contextValues.some((v) => v.startsWith(match?.[1] ?? '?'))).toBe(true);
    }
  });

  test('activation is lazy (no "*" or onStartupFinished)', () => {
    expect(manifest.activationEvents).not.toContain('*');
    expect(manifest.activationEvents).not.toContain('onStartupFinished');
  });

  test('restricted mode protects the bun path setting', () => {
    expect(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations).toContain(
      'bunCompanion.bunPath',
    );
    expect(contributes.configuration.properties['bunCompanion.bunPath'].scope).toBe('machine-overridable');
  });

  test('the task definition matches the TypeScript interface', () => {
    const [definition] = contributes.taskDefinitions;
    expect(definition.type).toBe('bunCompanion');
    expect(Object.keys(definition.properties).sort()).toEqual(['filter', 'package', 'script']);
  });

  test('only the bundle and metadata are packaged', () => {
    const ignore = read('.vscodeignore').split(/\r?\n/).filter(Boolean);
    expect(ignore[0]).toBe('**');
    expect(ignore.filter((l) => l.startsWith('!'))).toContain('!dist/extension.js');
    expect(ignore.some((l) => l.includes('node_modules'))).toBe(false);
  });
});

describe('source rules', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(dir, f));

  test('src/core never imports vscode or the vscode layer', () => {
    const offenders = sourceFiles('src/core').filter((f) =>
      /from '(vscode|\.\.\/vscode[^']*)'/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  test('no console.* in shipped code (use the log output channel)', () => {
    const offenders = sourceFiles('src').filter((f) => /\bconsole\.\w+\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test('no non-null assertions in shipped code', () => {
    const offenders = sourceFiles('src').filter((f) => /[\w)\]]!(\.|\[|\)|,|;)/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
