---
title: Frontmatter
tags: [guide]
order: 6
---

# Frontmatter

YAML frontmatter — the `---`-delimited block at the top of a note — is a primary
source of queryable metadata. flow-md turns every key into facts you can join
and filter on like any other relation.

## What you get

Each frontmatter key becomes a [[schema|`Frontmatter`]] fact:

```
Frontmatter(path: string, key: string, value: string)
```

Three conveniences:

- **Arrays expand.** `tags: [a, b]` yields one `Frontmatter` row per element.
- **`tags`/`tag` also feed `Tag`.** So `tags: [project]` is queryable both as
  `Frontmatter(p, "tags", "project")` and the friendlier `Tag(p, "project")`.
- **Numbers are also typed.** A numeric value additionally produces a
  `FrontmatterNumber(path, key, num)` fact, so you can compare and do arithmetic
  numerically (the string form in `Frontmatter` sorts lexicographically — `"10"`
  would come before `"9"`).

```
FrontmatterNumber(path: string, key: string, num: float)
```

## Reading a string value

Pull one key by name; the remaining variable is the value. Every page's title:

```datalog-query
Frontmatter(path, "title", title)
```

## Filtering by a value

Use a constant to filter. Every page tagged `guide`, via frontmatter:

```datalog-query
Frontmatter(path, "tags", "guide")
```

## Numeric comparisons

Each page here carries a numeric `order`. Because `order` is typed, you can
compare it — these are the later pages in the vault:

```datalog
LaterPage(path, n) :- FrontmatterNumber(path, "order", n), n > 5.
```

```datalog-query
LaterPage(path, n)
```

Numbers also work in joins and head arithmetic — see [[writing-rules]]. And the
raw typed facts are queryable directly:

```datalog-query
FrontmatterNumber(path, key, num)
```

## A note on types

YAML scalars keep their type: `priority: 3` is a number, `priority: "3"` (quoted)
is a string. Dates written as ISO strings (`due: 2026-05-24`) stay strings, which
happens to sort chronologically. Nested objects are flattened to their string
form for now; if you need to query into them, prefer flat keys.
