---
title: Updating results
tags: [reference]
order: 8
---

# Updating query results

Query results aren't just for reading: a result cell can be **edited**, and
flow-md writes the change back into the source file — toggle a task in a query
table and the `- [ ]` in your note becomes `- [x]`. This is the classic
*view-update problem*, restricted to the cases where the write is unambiguous.

## Which cells are writable?

A column is writable when flow-md can trace it back to **exactly one position
of one EDB relation** in the query body, and the owning plugin knows how to
rewrite that attribute in source text. Every query result carries a
`writable` list alongside its `columns`, so clients know up front.

The markdown plugin can write back:

| Relation      | Column   | Rewrite                                        |
| ------------- | -------- | ---------------------------------------------- |
| `Task`        | `status` | toggle the `[ ]` / `[x]` checkbox              |
| `Task`        | `text`   | replace the task line's text (plain text only) |
| `Heading`     | `text`   | replace the ATX heading's text                 |
| `Frontmatter` | `value`  | rewrite a single-line scalar `key: value`      |

The ICS plugin locates VEVENTs by UID (folded lines and TEXT escaping are
handled) and can write back:

| Relation           | Column        | Rewrite                              |
| ------------------ | ------------- | ------------------------------------ |
| `Event`            | `summary`     | rewrite (or insert) `SUMMARY`        |
| `EventLocation`    | `location`    | rewrite `LOCATION`                   |
| `EventDescription` | `description` | rewrite `DESCRIPTION`                |
| `EventStatus`      | `status`      | rewrite `STATUS`                     |

Tracing looks **through rules**: if `Open(p, t) :- Task(p, "open", t, _).` is
defined by exactly that one rule, then `t` in an `Open(p, t)` query is still
writable — the edit unfolds to the underlying `Task` fact. Heads defined by
several rules (no way to know which branch derived a row), aggregates,
arithmetic, joined variables, and negation stop the trace.

Everything else is read-only — including list-valued frontmatter and
tasks/headings whose text contains markdown formatting (their fact text
differs from the source text, so a rewrite could mangle the markup).

## The `/update` endpoint

```
POST /update
{ "id": "<query id>",          // or "q": "Task(path, \"open\", text, _)"
  "row": ["todo.md", "open", "buy milk", 3],
  "column": "status",
  "value": "closed" }
```

The server traces the edit to its source fact, re-reads the file and verifies
the fact is still derivable from it (a `409` means your row went stale —
refetch), lets the plugin rewrite the text, and replaces the file atomically.
The new content then flows through the same incremental path as a watcher
event, so every query that depends on the fact updates — not just the one you
edited.

Projected-away columns are recovered by matching the current facts: updating a
row of `Task(path, "open", text, _)` works as long as exactly one open task
has that text. If several match, the server asks you to add the missing
column (here `line`) to the query.

## Deleting and inserting facts

`POST /delete` removes the source text behind a fact — for tasks, the whole
line (nested sub-items included). It takes either a complete fact or a query
row resolved through the same lineage as `/update`:

```
POST /delete   { "rel": "Task", "row": ["todo.md", "open", "buy milk", 3] }
POST /delete   { "id": "<query id>", "row": [...] }   // add "rel" if several qualify
```

`POST /insert` adds source text deriving a new fact. The target file comes
from the relation's *path attribute* — each plugin declares which column
holds the file path when it marks a relation insertable, and the declaration
is validated against the plugin's schema at startup (for `Task` it's `path`).
Locator columns you can't know yet (line numbers) are passed as `0`, which
appends at the end of the file (any other value inserts before that line):

```
POST /insert   { "rel": "Task", "row": ["todo.md", "open", "water plants", 0] }
```

Both write the file atomically and feed the change back through the
incremental path, exactly like `/update`.

## From the command line

```bash
flow-md update 'Task(path, status, text, line)' \
  --row '["todo.md", "open", "buy milk", 3]' \
  --column status --value closed
```

## Try it

With the server running on this vault:

```bash
curl -X POST localhost:5173/update \
  -d '{"q": "Task(path, \"open\", text, line)",
       "row": ["docs/roadmap.md", "open", "some item", 12],
       "column": "status", "value": "closed"}'
```
