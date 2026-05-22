---
title: Writing rules
tags: [guide]
---

# Writing rules

A fenced code block tagged `datalog` defines **rules**. Rules derive new
relations (**IDBs** — intensional) from the [[schema|EDB facts]] and from each
other. Every `datalog` block in the whole vault is combined into one program, so
a relation defined on one page can be queried on another.

A rule has a head and a body:

```
Head(x, y) :- Body1(x, z), Body2(z, y).
```

Read `:-` as "if": derive `Head(x, y)` for every binding of the body. Variables
shared between atoms (`z` here) are joins. You can declare relations across many
rules; the engine figures out evaluation order, recursion and stratification.

## A first rule

This block defines `GuidePage` — every file tagged `guide`:

```datalog
GuidePage(path) :- Tag(path, "guide").
```

You don't declare column types: flow-md infers a relation's shape from its
rules. String literals use double quotes, numbers are bare.

The [[getting-started]] page queries `GuidePage`; so can we, right here:

```datalog-query
GuidePage(path)
```

## What rules can express

flow-md passes rules straight to flow-ts, so you get its full surface:

- **Joins** — share variables across body atoms.
- **Recursion** — a relation can refer to itself (transitive reachability, etc.).
- **Negation** — `!Atom(...)` for "there is no such fact" (stratified).
- **Comparisons** — `x != y`, `line > 10`, in the body.
- **Head arithmetic** — compute values in the head, e.g. `Next(x + 1)`.
- **Aggregation** — `min` / `max` / `sum` / `count` in the head.

See the [flow-ts README](https://github.com/theknarf-experiments/flow-ts) for the
precise grammar. The [[examples]] page has more working rules.

## Editing rules

Changing a `datalog` block rebuilds the program (rules define its structure).
Changing ordinary prose, tags or links instead streams a fact update through the
existing program — much cheaper. Either way, open queries update on the next save.
