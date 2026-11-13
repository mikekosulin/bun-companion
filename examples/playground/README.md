# Playground

A small Bun monorepo for developing Bun Companion. `F5` in the extension repo opens it.

| Package | Shows |
|---|---|
| `apps/web` | `workspace:^`, catalogs, `pre`/`post` scripts, a long-running dev server |
| `apps/api` | `workspace:~`, an interactive script (`migrate`) and a failing one (`fail`) |
| `packages/ui` | `workspace:*`, peer dependency from the catalog |
| `packages/core` | a leaf package with `bun test` |
| `tooling/tsconfig` | a package without scripts |

Things to try:

- Run `build` on `apps/web` with **Run Script with Dependencies**: core → ui → web, in order.
- Ctrl/Cmd+click `workspace:^` or `catalog:` in `apps/web/package.json`.
- Rename a dependency to `@playground/cor` and watch the diagnostic and its quick fix.
