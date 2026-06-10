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
- **One view, no edit mode**: the rendered note *is* the editor, and editing
  feels continuous rather than modal. Click anywhere in a block — paragraph,
  heading, list, quote, table, code fence — and it becomes in-flow source
  with the caret where you clicked. `Enter` at the end of a paragraph
  commits and keeps writing in a fresh block below (Notion-style;
  `Shift+Enter` is a literal newline); `ArrowUp`/`ArrowDown` past a block's
  edge walk the caret into the neighbouring block; blur or `⌘Enter` commits
  and `Escape` cancels. The optimistic save re-renders committed blocks
  instantly. Frontmatter shows as a collapsed `⋯ title, tags` chip you can
  click to edit, dataviews carry a ✎ to edit their query, and a trailing `+`
  appends a block. This all works in `.mdx` too — a remark plugin stamps
  source positions through MDX compilation, including onto JSX blocks, so
  `<Kanban/>` gets a hover-✎ that opens its own source. A `</>` toggle in
  the header still opens the whole file as raw text — the escape hatch for
  broken MDX, `.ics` files, or wholesale rewrites.
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
- **File management in the sidebar**: file-type icons, rename files,
  create/rename/delete folders and subfolders (empty folders included).
- **More file types**: `.ics` renders as a date-grouped agenda, `.csv` as an
  editable grid (Tanstack Table — click cells, add/delete rows), and `.mdx`
  is markdown plus components.
- **MDX component registry**: `<Kanban query="Task(path, status, text, line)"
  groupBy="status" …/>` renders a board whose lane moves rewrite the source
  checkbox, and `<Graph/>` draws the Obsidian-style connected-notes graph
  from any edge-shaped query. See [[board.mdx|board]] and [[graph.mdx|graph]].

## Data layer

Frontend state lives in two [TanStack DB](https://tanstack.com/db) collections
(`src/lib/db.ts`), both synced by polling and mirrored from the server:

- `notes` — every vault file `{ path, content, mtime }`, bulk-synced from
  `GET /contents`. Updating a note saves the whole file; editor saves and
  checkbox toggles go through here.
- `queries` — every query block's `QueryResult`, keyed by id. Editing a cell
  updates the row optimistically; the write-through handler diffs the change
  back into `(row, column, value)` and posts the lineage-checked `/update`.

Components read these with `useLiveQuery` and never fetch directly.

## Shape of the code

```
packages/app/src
├── routes/           __root (sidebar shell), index, note.$ (splat = path)
├── components/       FileTree, NotePage, MarkdownView, MdxView, DataView,
│                     Kanban, Graph, IcsView, CsvView, CommandPalette, Editor
│                     (+ *.module.css and *.stories.tsx per component)
└── lib/              db.ts (TanStack DB collections + mutations), api.ts,
                      tree.ts, wiki.ts, fuzzy.ts, ics.ts, graph.ts, icons.ts
```

Styling is per-component CSS Modules over a small global base (theme
variables + shared utilities). Components have Storybook stories
(`pnpm --filter @flow-md/app storybook`) and portable-story tests that
render every story in CI.

The markdown pipeline is react-markdown + remark-gfm plus two tiny remark
plugins: one turns `[[target]]` spans into `wiki:` links, one stamps each
task-list item with its source line (`data-line`) so the checkbox knows which
fact to toggle. `datalog-query` fences are intercepted at the `<pre>` level
and matched to the server's query results by fence line.
