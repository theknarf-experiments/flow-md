# @flow-md/ui

Presentational components shared across flow-md's surfaces — currently the
IWA shell, with the main app to follow.

Two rules keep these reusable:

- **No colours of their own.** Everything is expressed in the theme variables
  (`--fg`, `--fg-dim`, `--accent`, `--border`, `--mono`, …) that the consuming
  app defines, so the same component reads correctly on the shell's per-space
  gradient and on the app's light/dark palette.
- **No app state.** Props in, callbacks out. Anything that needs to know about
  tabs, spaces or the vault stays in the app.

Ships raw TypeScript (no build step), like `@flow-md/view-*`; consumers must
keep it out of the esbuild prebundle — see the shell's `vite.config.ts`.

| component | |
| --- | --- |
| `IconButton` | square icon-sized button used across toolbars |
| `Tab` | a tab row: label, optional pin toggle and close |
| `CommandBar` | centered modal input with a hint line |
| `LogPanel` | fixed-corner scrolling log with tone colours |
