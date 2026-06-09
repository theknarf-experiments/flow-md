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
- **Edit mode**: a plain textarea with `⌘S` save through `PUT /file`. The
  save feeds the vault directly, so dataviews everywhere update incrementally
  without waiting on the file watcher.
- **Optimistic everything**: mutations render instantly from TanStack DB's
  optimistic overlay and roll back automatically (with the server's reason
  shown) if the write is rejected — e.g. a stale row hitting the concurrency
  check.
- **Offline reads**: the sync cache persists to localStorage, so the vault
  still renders with the server unreachable. Writes need the server — flow-md
  is the source of truth, not a CRDT.

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
├── components/       FileTree, NotePage, MarkdownView, DataView, Editor
└── lib/              db.ts (TanStack DB collections + mutations),
                      api.ts (server client), tree.ts, wiki.ts, usePoll.ts
```

The markdown pipeline is react-markdown + remark-gfm plus two tiny remark
plugins: one turns `[[target]]` spans into `wiki:` links, one stamps each
task-list item with its source line (`data-line`) so the checkbox knows which
fact to toggle. `datalog-query` fences are intercepted at the `<pre>` level
and matched to the server's query results by fence line.
