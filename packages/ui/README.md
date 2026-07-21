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
| `Sidebar` | fixed-width collapsible chrome column (+ `Toolbar`, `SectionLabel`, `SidebarButton`, `Spacer`) |
| `Tab` | a tab row: label, optional pin toggle and close |
| `SpaceRail` | the segmented row of spaces along a sidebar's bottom |
| `AddressPill` | reads as an address field, behaves as a button |
| `IconButton` | square icon-sized button used across toolbars |
| `CommandPalette` | modal input, with or without a result list |
| `LogPanel` | fixed-corner scrolling log with tone colours |
| `Banner` | a strip of bad news, optionally pinned to the top |
| `DataView` | sortable query-result table with in-place cell editing |
| `EditableGrid` | editable table grid — the markdown and CSV editors |
| `RawEditor` | textarea + save bar, with clean/dirty/saving/error |

Two components carry a deliberate design note:

**`CommandPalette` is every palette.** The app's ⌘K (notes, content,
commands) and the shell's ⌘T/⌘L (tabs, commands, addresses) are the same
component searching different things — and the same `fuzzyFilter`, exported
here, ranks both, so a match feels identical in either surface. Callers pass
`items`; the component owns the interaction — keyboard nav, dismissal,
scroll-into-view, and routing wheel events to the list so the page behind
can't scroll. Omitting `items` leaves a bare input whose Enter calls
`onSubmit`.

**`EditableGrid` is both grids.** The markdown pipe-table editor and the CSV
viewer were ~350 lines of near-duplicate differing only in which affordances
were on, so this is their union with the differences as flags
(`editableHeader`, `sortable`, `canAddColumn`, …). Data in, whole table out:
every mutation calls `onChange` with the next table and the caller decides
what that means — re-serialize a markdown block, save a `.csv`. Both call
sites are now ~35 lines.

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
