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
| `Sidebar` | fixed-width collapsible chrome column (+ `SectionLabel`, `Spacer`) |
| `Tab` | a tab row: label, optional pin toggle and close |
| `SpaceRail` | the segmented row of spaces along a sidebar's bottom |
| `AddressPill` | reads as an address field, behaves as a button |
| `IconButton` | square icon-sized button used across toolbars |
| `CommandPalette` | modal input, with or without a result list |
| `LogPanel` | fixed-corner scrolling log with tone colours |
| `DataView` | sortable query-result table with in-place cell editing |

Two components carry a deliberate design note:

**`CommandPalette` is both palettes.** The app's ⌘K (files, content, commands)
and the shell's address bar only ever differed in whether results were passed,
so they're one component: pass `items` for a searchable list, omit them and
Enter calls `onSubmit` with the raw text. What to search and how to rank stays
with the caller; the component owns the interaction — keyboard nav, dismissal,
scroll-into-view, and routing wheel events to the list so the page behind
can't scroll.

**`DataView` takes an `onEditCell` callback** rather than importing the app's
write-through store — omit it and the table is read-only, which is what keeps
the component free of app state.

`Sidebar` carries two app-window affordances that are simply no-ops in a
normal browser tab: the surface is a window drag region, and its top padding
grows by `env(titlebar-area-height)` when a window-controls overlay is
active.

## Storybook

This is the **only** Storybook in the monorepo, and it globs sibling packages
too:

```bash
pnpm --filter @flow-md/ui storybook   # :6007
```

so a story can live next to the component it documents — the view plugins own
their `Calendar` and `FileTree` stories rather than having them stranded in
whichever package happened to host Storybook. `tests/stories.test.tsx` renders
every one of them via portable stories, so a story that stops rendering fails
CI rather than just looking wrong.
