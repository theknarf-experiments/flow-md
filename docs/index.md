---
title: flow-md
tags: [reference]
---

# flow-md

Turn a folder of markdown into a live [Datalog](https://en.wikipedia.org/wiki/Datalog)
notebook. flow-md watches your notes, derives **facts** from their structure
(headings, links, tags, frontmatter), reads `datalog` code blocks as **rules**,
and answers `datalog-query` code blocks **inline** — re-evaluating
incrementally as you edit.

This `docs/` folder *is* a flow-md vault. Every query block below is real:

```bash
pnpm -F @flow-md/server build
node packages/server/dist/bin.js serve docs/
```

…then open any page in Vim with the plugin installed, and the tables render
themselves.

## The pages of this vault

The query below lists every markdown file flow-md has indexed here. It uses the
built-in [[schema|`File`]] relation — no rule needed.

```datalog-query
File(path, mtime)
```

## Where to go next

- [[getting-started]] — install, build, run the server.
- [[schema]] — the facts flow-md derives from every note.
- [[writing-rules]] — define your own relations with `datalog` blocks.
- [[writing-queries]] — ask questions with `datalog-query` blocks.
- [[vim-plugin]] — render results inline in Vim.
- [[examples]] — a cookbook of working queries.

## How it fits together

```
markdown files ──▶ facts (File, Heading, Link, Tag, Frontmatter, CodeBlock)
   ```datalog ──▶ rules ─┐
                          ├─▶ flow-ts engine ─▶ query results ─▶ Vim (inline)
```datalog-query ─▶ goals ┘
```

flow-md is built on [flow-ts](https://github.com/theknarf-experiments/flow-ts),
a TypeScript Datalog engine on incremental dataflow.
