---
title: Schema
tags: [reference]
order: 3
---

# Schema

Every markdown file is parsed into its syntax tree, and the tree *is* the
data. The relations you'll usually write queries against — `Heading`, `Task`,
`Link` — are rules over it, shipped with the plugin. Nothing stops you from
querying the tree directly when you want something nobody named.

## What the parser reads

These are **EDB relations**: extensional, meaning they come from the file
rather than from rules.

| Relation      | Columns                                        | Source |
|---------------|------------------------------------------------|--------|
| `File`        | `path: string, mtime: number`                  | one per markdown file |
| `MdNode`      | `path: string, id: number, parent: number, type: string, line: number, start: number, end: number` | every node of the tree, in document order; `parent` is `-1` at the root |
| `MdNodeText`  | `path: string, id: number, text: string`       | what a node reads as — its own text for a leaf, its subtree flattened for a parent |
| `MdProp`      | `path: string, id: number, key: string, value: string` | whatever the parser hung on the node: a link's `url`, a fence's `lang`, a checkbox's `status` |
| `MdPropNum`   | `path: string, id: number, key: string, num: float` | the numeric ones, typed — a heading's `depth` |
| `Frontmatter` | `path: string, key: string, value: string`     | each YAML frontmatter key (arrays expand to one row per item) |
| `FrontmatterNumber` | `path: string, key: string, num: float`  | the numeric ones, typed |
| `MdWikiLink`  | `path: string, dst: string, text: string, line: number` | `[[Target]]` / `[[Target\|alias]]` |
| `MdInlineTag` | `path: string, tag: string, line: number`      | `#tags` written in prose |

Frontmatter, wiki-links and inline tags are facts rather than views for the
same reason: YAML is another language and `#tag` is a regular expression.
Neither is something a rule can derive.

## What the rules define

These have no rows of their own — they're computed from the table above every
time the vault evaluates.

| Relation      | Columns                                        | Definition |
|---------------|------------------------------------------------|--------|
| `Heading`     | `path: string, level: number, text: string, line: number` | a node of type `heading`, with its `depth` |
| `Task`        | `path: string, status: string, text: string, line: number` | a list item with a checkbox, and its own paragraph's text |
| `Link`        | `src: string, dst: string, kind: string`       | `[[wiki]]` (kind `"wiki"`) and `[md](url)` (kind `"md"`) links |
| `LinkLabel`   | `src: string, dst: string, text: string, line: number` | the same links, with what the reader sees |
| `Tag`         | `path: string, tag: string`                    | inline `#tags` and frontmatter `tags:` |
| `CodeBlock`   | `path: string, lang: string, line: number`     | fenced code blocks (excluding `datalog` / `datalog-query`) |

Notes:

- `path` is always vault-relative (e.g. `schema.md`), and joins everything together.
- Editing a view edits the file: the write is traced back through the rule to
  the cell it was read from. Toggling a `Task`'s status rewrites one character
  of a checkbox. See [[updating]].
- `Link.dst` is the **raw** link target — `[[Schema]]` yields `dst = "Schema"`,
  not `schema.md`. Resolving targets to files is something you can express as a
  rule (or a future built-in).
- `mtime` and `line` are plain numbers, usable in comparisons and arithmetic.

## Every heading in this vault

A live look at the `Heading` relation across all the docs:

```datalog-query
Heading(path, level, text, line)
```

## Every frontmatter key

```datalog-query
Frontmatter(path, key, value)
```

## The tree underneath

The same headings, as the parser sees them:

```datalog-query
MdNode(path, id, parent, "heading", line, start, end)
```

See [[writing-queries]] for how the variable names above become the table's
column headers.
