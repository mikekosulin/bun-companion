# Contributing

## Setup

You need [Bun](https://bun.com) (version in `packageManager`) and Node from `.nvmrc` — `vsce` and the VS Code test runner are Node tools.

```sh
bun install
```

## Run the extension

Open the repo in VS Code and press **F5** (_Run Extension (playground)_). A second window opens with the extension loaded from source and [`examples/playground`](examples/playground) — a small Bun monorepo that exercises every feature. A watch build runs in the background; press `Cmd/Ctrl+R` in that window to reload after a change.

## Layout

| Path                  |                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `src/core`            | Pure logic: discovery, graph, commands, `package.json` parsing, lint. No `vscode` import. |
| `src/vscode`          | VS Code integration: store, tree, tasks, commands, language features.                     |
| `test/unit`           | `bun:test` suites for `src/core` and the manifest.                                        |
| `test/integration`    | Mocha suites that run inside a real VS Code against `test/fixtures`.                      |
| `examples/playground` | Manual testing and screenshots.                                                           |

## Tests

The extension runs on VS Code's Node, while development happens on Bun, so the same code is checked in both runtimes:

```sh
bun run test:coverage     # unit tests on Bun, fails under 95% line/function coverage
bun run test:node         # the same unit tests on Node
bun run test:bundle       # the production bundle loads on Node
bun run test:integration  # real VS Code: basic, multi-root and non-Bun workspaces
bun run check             # typecheck + lint + all of the above except integration
```

`VSCODE_TEST_VERSION=1.96.0 bun run test:integration` runs against the oldest supported VS Code.

## CI locally

The GitHub Actions workflow can be run with [act](https://github.com/nektos/act) (Docker required). `ci:local` builds a small image from [`.github/act/Dockerfile`](.github/act/Dockerfile) — the stock act image with `node` on the default `PATH` and the libraries VS Code needs under `xvfb` — and passes any act flags through. act only runs Linux jobs; the macOS and Windows parts of the matrix run on GitHub.

```sh
bun run ci:local -j unit-node
bun run ci:local -j integration --matrix os:ubuntu-latest
```

## Style

- Biome formats and lints (`bun run format`).
- Keep comments to a minimum: only for a non-obvious _why_. Tests document behaviour.
- Everything in the repository is in English.
- Every feature comes with unit tests for its logic and an integration test for its VS Code wiring.

## Branches and releases

`main` is protected: changes land through pull requests that pass the **CI passed** check, and are squash-merged so the history stays linear.

To release:

1. In a pull request, bump `version` in `package.json` and move the `CHANGELOG.md` entry from "unreleased" to today's date.
2. After it is merged, tag the merge commit and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m "Bun Companion 0.2.0"
   git push origin v0.2.0
   ```

3. Approve the `release` deployment in the Actions run. The workflow checks that the tag matches `package.json`, runs every check, publishes to the Visual Studio Marketplace (and Open VSX once enabled) with trusted publishing, and attaches the `.vsix` to a GitHub release.

Only maintainers can create `v*` tags, and published tags cannot be moved or deleted. A mistake is fixed with a new patch version.
