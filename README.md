# Bun Companion

[![CI](https://github.com/mikekosulin/bun-companion/actions/workflows/ci.yml/badge.svg)](https://github.com/mikekosulin/bun-companion/actions/workflows/ci.yml) [![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/mikekosulin/bun-companion/badges/coverage.json)](https://github.com/mikekosulin/bun-companion/actions/workflows/coverage.yml) [![VS Marketplace](https://vsmarketplacebadges.dev/version-short/mikekosulin.bun-companion.svg)](https://marketplace.visualstudio.com/items?itemName=mikekosulin.bun-companion) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Bun, right inside VS Code. Bun Companion turns any Bun project into a panel of runnable scripts, understands monorepos with workspaces and catalogs, and checks your `package.json` as you type. No setup, no telemetry, nothing to install besides the extension.

- **Any Bun project**: open the folder and every script is one click away, with a live ✓ or ✗ when it finishes.
- **Monorepo**: packages grouped by folder; build an app together with its libraries, in dependency order; `workspace:` and `catalog:` become links.
- **Team**: every run is a VS Code task, so `tasks.json`, keybindings and _Rerun Last Task_ just work, and _Copy Command_ gives the exact `bun` line for CI.

### Install

From the Visual Studio Marketplace — search for **Bun Companion**, or:

```bash
code --install-extension mikekosulin.bun-companion
```

Cursor, Windsurf and VSCodium: Open VSX is coming soon; until then, download the `.vsix` from [GitHub Releases](https://github.com/mikekosulin/bun-companion/releases/latest) and run _Extensions: Install from VSIX…_.

### Start

Open a Bun project: a `package.json` next to `bun.lock`, `bunfig.toml` or `"packageManager": "bun@…"`. Monorepos are found from any package inside them. The Bun icon appears in the Activity Bar. Everything is also in the Command Palette under **Bun Companion**: _Run Script…_, _Go to Package…_, _Open Terminal in Package_.

Running scripts needs [Bun](https://bun.com/docs/installation). It is found on `PATH`, in `$BUN_INSTALL`, `~/.bun/bin` or Homebrew, or set with `bunCompanion.bunPath`. Browsing and navigation work without it.

**What it does:**

- **Scripts** — every script of the project, and of each workspace package in a monorepo; `pre`/`post` hooks folded into the script they wrap; problems such as invalid `package.json`, unnamed packages, duplicate names and dependency cycles on top. Follows the file you are editing.
- **Run** — ▶ on a script runs it in its package. Right-click for _with dependencies_ (`bun run --filter 'pkg...'`) and _in dependents_ (`--filter '...pkg'`); Bun orders them by the dependency graph. A spinner while it runs, ✓ or ✗ with the exit code after, ⏹ to stop it.
- **Navigate** — Ctrl/Cmd+click `workspace:*` to open that package, `catalog:` or `catalog:<name>` to jump to the catalog entry, including in root `overrides`. Hover for the version and path.
- **Check** — `package.json` problems as you type: unknown workspace packages, unknown catalogs, missing catalog entries, a package in both `catalog` and `catalogs.default`, duplicate names. Typos get a quick fix.
- **Complete** — workspace package names, `workspace:*` / `^` / `~`, and the catalogs that list the dependency.
- **Stay out of the way** — the status bar shows the current package; any command can be hidden with `bunCompanion.commands.hidden`; nothing appears in folders that are not Bun projects.

**Coming next:** `bunfig.toml` completion and checks, a `bun.lock` explorer ("why is this installed?"), tests per package, dependency updates, and tools for AI agents.

**Safe and private.** No telemetry and no network access. Workspace data comes from reading `package.json` files; `bun` runs only when you run a script. In [Restricted Mode](https://code.visualstudio.com/docs/editor/workspace-trust) you can browse, but scripts don't run.

**Unofficial.** Bun Companion is a community project, not affiliated with or endorsed by Oven or the Bun project. Bun and the Bun logo are trademarks of Oven, Inc. The official extension, [`oven.bun-vscode`](https://marketplace.visualstudio.com/items?itemName=oven.bun-vscode) (debugger, test runner), works side by side with this one.

Like it? [Star it](https://github.com/mikekosulin/bun-companion) · Something wrong? [Open an issue](https://github.com/mikekosulin/bun-companion/issues/new/choose) · Vulnerability? [Report privately](SECURITY.md)

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE)
