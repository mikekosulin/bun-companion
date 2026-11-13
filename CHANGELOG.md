# Changelog

## 0.1.0 — unreleased

First release.

- Works in any Bun project; monorepos with workspaces get every package, grouped by folder.
- Packages view: scripts with live run state (running, exit code, stop), `pre`/`post` hooks folded in, problems on top, follows the active editor.
- Run scripts in a package, with its dependencies (`pkg...`), in its dependents (`...pkg`) or in all packages, as VS Code tasks (`bunCompanion` task type).
- Commands: Run Script…, Run Script in All Packages…, Go to Package…, Open Terminal in Package, Reveal Active File's Package, Copy Command.
- `package.json`: go to definition, hover, completion and diagnostics with quick fixes for `workspace:` and `catalog:` dependencies, including `catalog:` in root `overrides` and conflicting `catalog` / `catalogs.default` entries.
- Status bar entry for the active file's package; any command can be hidden with `bunCompanion.commands.hidden`.
- Multi-root windows, Restricted Mode, auto-detection of the `bun` executable.
