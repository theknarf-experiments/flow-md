---
title: Web app
tags: [reference]
order: 9
---

# The flow-md web app

`@flow-md/app` is a simplified Obsidian-style interface for a flow-md vault:
a file-tree sidebar, rendered markdown notes, and `datalog-query` blocks
shown as **live dataview tables**. It's built with React + TanStack Start
(SPA mode) and is a pure client of `flow-md serve` — all parsing, the
Datalog session and file watching stay in that one process.

```bash
pnpm dev          # mprocs: flow-md server on :4747 + app on :4748
```

…or run the pieces yourself:

```bash
node packages/cli/dist/bin.js serve docs/ --port 4747
pnpm --filter @flow-md/app dev        # http://localhost:4748
```

Point the app at a different server with `VITE_FLOWMD_SERVER=http://host:port`.

## What works

- **File tree** of everything the vault indexes (`.md` and `.ics`), with
  “+ note” creating files through `PUT /file`.
- **Rendered markdown** with GFM, frontmatter hidden, and `[[wiki links]]`
  resolved Obsidian-style (exact path first, then unique basename).
- **Live dataviews**: every `datalog-query` block renders as a table
  (Tanstack Table, so headers click-sort) that polls the server — edits made
  anywhere, another editor, the CLI, a `curl`, show up while you watch.
  Columns the server marks [[updating|writable]] carry a ✎ and are editable
  in place; the edit goes through the lineage-checked update path and lands
  in the source file.
- **Task checkboxes** are real: ticking one rewrites the `- [ ]` in the
  markdown via the same path.
- **Typora-style live editing**: `.md` notes open in a CodeMirror 6 editor
  whose document *is* the markdown source, with syntax hidden until the
  caret touches a construct — click into a bold word and the `**` reveal
  around it, leave and they vanish; heading `#`s, link targets and
  `[[wiki-bracket]]`s behave the same (mod+click follows links). Tasks
  render as real checkboxes, `datalog-query` fences render as live
  dataviews, **pipe tables render as editable Tanstack grids** (click cells,
  edit headers, add rows/columns — commits re-serialize just the table),
  and frontmatter collapses to a `⋯ title, tags` chip. Edits save through
  the optimistic store, debounced; because the source is the document,
  files stay byte-exact apart from what you actually type.
- `.mdx` notes live-edit the same way: JSX blocks are just another rich
  block — rendered as their evaluated component (`<Kanban/>` is a live,
  draggable board *inside the editor*) while the caret is elsewhere, raw
  JSX text when it's inside (hover-✎ jumps in). A small scanner finds
  component spans, since multi-line JSX isn't valid CommonMark; compiled
  snippets are cached by source. A `</>` toggle in the header still opens
  any file as raw text — the escape hatch for half-typed JSX, `.ics`
  files, or wholesale rewrites.
- **Optimistic everything**: mutations render instantly from TanStack DB's
  optimistic overlay and roll back automatically (with the server's reason
  shown) if the write is rejected — e.g. a stale row hitting the concurrency
  check.
- **Offline reads**: the sync cache persists to localStorage, so the vault
  still renders with the server unreachable. Writes need the server — flow-md
  is the source of truth, not a CRDT.
- **⌘K command palette** (Tanstack Hotkeys): fuzzy file search, free-text
  search across every note's content, and app commands. **⌘B** toggles the
  sidebar (there are buttons too).
- **Dark/light theme**: follows the OS until you pick — the sidebar's ☀/☾
  button (or the palette's "Toggle dark/light theme") flips and remembers.
  Everything, including code-block syntax colors, runs off CSS variables
  keyed by `<html data-theme>`, set before first paint so nothing flashes.
- **The sidebar is a view plugin too**: it's `<FileTree>`, driven by
  `File(path, mtime)` and `Folder(path)` queries. File-type icons, rename,
  delete, and create folders/files all run through the host's row mutations —
  there's no special file-management API. Because it's just a query view, the
  same component embeds in any note as a filtered index, e.g.
  `<FileTree files="Tag(path, 'project')" />`.
- **More file types**: `.ics` renders as a date-grouped agenda (a view plugin
  registered as the default `.ics` viewer, reading the ICS plugin's `Event*`
  facts — no client-side parsing), `.csv` as an editable grid (Tanstack
  Table), and `.mdx` is markdown plus components. The same calendar is an MDX
  component too: `<Calendar/>` shows every event in the vault,
  `<Calendar path="cal/work.ics"/>` scopes to one file.
- **View plugins**: `.mdx` notes can embed Datalog-query-driven React
  components. `<Kanban query="Task(path, status, text, line)" groupBy="status"
  …/>` renders a board whose lane moves (drag or buttons) rewrite the source
  checkbox, `<Graph/>` draws the Obsidian-style connected-notes graph from
  any edge-shaped query, and `<Diagram query="…">` hands query rows to a
  function child that returns a [modular-svg](https://github.com/theknarf-experiments/modular-svg)
  scene — custom diagrams (`stackH`, `rect`, `arrow`, …) that re-solve live
  as the vault changes ([[diagram.mdx|diagram]]). See also [[board.mdx|board]]
  and [[graph.mdx|graph]]. These ship as standalone packages —
  `@flow-md/view-kanban`, `@flow-md/view-graph`, `@flow-md/view-filetree`,
  `@flow-md/view-diagram` — built on the `@flow-md/view-api` plugin contract,
  so new view types can be added (by anyone) without touching the app.

## Data layer

Frontend state lives in two [TanStack DB](https://tanstack.com/db) collections
(`src/lib/db.ts`), both synced by polling and mirrored from the server:

- `notes` — every vault file `{ path, content, mtime }`, bulk-synced from
  `GET /contents`. Updating a note saves the whole file; editor saves and
  checkbox toggles go through here.
- `queries` — every query block's `QueryResult`, keyed by id. Editing a cell
  updates the row optimistically; the write-through handler diffs the change
  back into `(row, column, value)` and posts the lineage-checked `/update`.

Components read these with `useLiveQuery` and never fetch directly. The file
list and folders aren't collections — they're `File`/`Folder` Datalog queries
the sidebar runs through the host.

## Shape of the code

```
packages/app/src
├── routes/           __root (sidebar shell — builds the app-level host),
│                     index, note.$ (splat = path)
├── components/       NotePage, DataView, IcsView, CsvView, CommandPalette,
│                     Editor (+ *.module.css per component)
│   └── editor/       LiveEditor + live-preview (CM6 Typora view), widgets,
│                     MdTableGrid
├── lib/              db.ts (TanStack DB collections), api.ts, host.ts (the
│                     view-plugin host impl), wiki, fuzzy, ics
└── plugins.ts        the registered view plugins → the MDX component registry

packages/view-api       the plugin contract (host interface, FlowMdViewPlugin,
                        FlowMdHostProvider / useFlowMd)
packages/view-kanban    the <Kanban> plugin       ┐
packages/view-graph     the <Graph> plugin        │ depend only on view-api;
packages/view-filetree  the <FileTree> plugin     │ no app imports
packages/view-ics       the <Calendar> plugin     ┘ (also the .ics handler)
```

A plugin contributes MDX `components` and/or `fileHandlers` (default viewers
for a file extension). The app flattens both across all plugins in
`plugins.ts` — the component registry for MDX, and an extension→viewer map the
note view consults before falling back to raw text.

The host is built once in the Shell and provided to the whole tree, so the
sidebar reads it from context and the editor threads the same instance into
its MDX widgets (which render in detached roots).

A view plugin is a React component (driven by `useQuery` from the host) plus
a `{ name, components }` export. The app provides the host — query polling,
cell writes, note navigation, wiki resolution — through a React context that
wraps each MDX block, so a plugin never imports the app or talks to the
server directly. See `packages/view-api/README.md` for the authoring guide.

Styling is per-component CSS Modules over a small global base (theme
variables + shared utilities). Components have Storybook stories
(`pnpm --filter @flow-md/app storybook`) and portable-story tests that
render every story in CI.

The markdown pipeline is react-markdown + remark-gfm plus two tiny remark
plugins: one turns `[[target]]` spans into `wiki:` links, one stamps each
task-list item with its source line (`data-line`) so the checkbox knows which
fact to toggle. `datalog-query` fences are intercepted at the `<pre>` level
and matched to the server's query results by fence line.
