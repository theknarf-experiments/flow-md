---
title: Writing queries
tags: [guide]
---

# Writing queries

A fenced code block tagged `datalog-query` asks a question. The block is a rule
**body** — one or more atoms (and comparisons) — and flow-md shows the bindings
that satisfy it. The variables you mention become the table's columns, in the
order they first appear.

## Selecting and filtering

Mention a variable to project it; use a constant to filter. This finds the path
of every page tagged `reference`:

```datalog-query
Tag(path, "reference")
```

The column is `path` — `"reference"` is a constant, so it isn't a column.

## Joining

List several atoms to join them on shared variables. Top-level headings of guide
pages — joining `Heading` and `Tag` on `path`:

```datalog-query
Heading(path, 1, title, line), Tag(path, "guide")
```

Columns are `path`, `title`, `line` (the variables, in first-appearance order);
the `1` pins the heading level.

## Checking existence

To ask "does anything match?", query with a variable and look at whether the
table comes back empty. "Are there any reference pages?" — rows mean yes:

```datalog-query
Tag(path, "reference")
```

> A query must currently bind at least one variable. Fully-constant existence
> checks (e.g. `Tag("index.md", "reference")` with no variables) are a known
> limitation of the underlying engine and are not yet supported.

## How it works

Under the hood flow-md wraps each query body in a synthetic rule
(`Q… (vars) :- body.`), so a query is just a rule whose result you watch. That's
why anything you can put in a rule body works in a query.

Querying a relation you defined elsewhere is the same as querying an EDB — see
[[writing-rules]] for `GuidePage`, and [[examples]] for a cookbook.
