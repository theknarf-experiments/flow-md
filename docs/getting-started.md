---
title: Getting started
tags: [guide]
order: 2
---

# Getting started

flow-md is a pnpm/turbo monorepo with [flow-ts](https://github.com/theknarf-experiments/flow-ts)
vendored as a git submodule.

## Install

```bash
git clone --recurse-submodules <flow-md repo>
cd flow-md
mise install        # Node 24.15.0 (or use your own Node ≥ 20)
corepack enable     # resolves pnpm from the packageManager field
pnpm install
pnpm -r run build
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init
```

## Run the server

Point `flow-md serve` at any directory of markdown:

```bash
node packages/cli/dist/bin.js serve docs/ --port 4747
```

It scans the folder, builds the program from every `datalog` block, evaluates
all queries, and starts an HTTP server. Edits are picked up by a file watcher
and re-evaluated **incrementally** — a content edit only re-runs the affected
derivations; only changing a rule or query rebuilds the program.

### Endpoints

| Endpoint                 | Returns                                   |
|--------------------------|-------------------------------------------|
| `GET /health`            | `{ ok, error }`                           |
| `GET /queries?file=<rel>`| every query block in that file, with rows |
| `GET /query/<id>`        | a single query's current result           |

`<rel>` is a vault-relative path, e.g. `getting-started.md`.

```bash
curl -s 'localhost:4747/queries?file=index.md' | jq
```

## Render results in your editor

See [[vim-plugin]] for the Vim setup. The plugin talks to this server and draws
each query result as a table inline, below its block — without modifying the file.

## This page

This note is tagged `guide`. The [[writing-rules]] page defines a `GuidePage`
relation; here is every guide page in the vault:

```datalog-query
GuidePage(path)
```
