---
title: Schema
tags: [reference]
order: 3
---

# Schema

flow-md derives a fixed set of **EDB relations** (extensional — facts that come
from data, not rules) from every markdown file. Your rules and queries build on
these.

| Relation      | Columns                                        | Source |
|---------------|------------------------------------------------|--------|
| `File`        | `path: string, mtime: number`                  | one per markdown file |
| `Heading`     | `path: string, level: number, text: string, line: number` | each ATX heading |
| `Link`        | `src: string, dst: string, kind: string`       | `[[wiki]]` (kind `"wiki"`) and `[md](url)` (kind `"md"`) links |
| `Tag`         | `path: string, tag: string`                    | inline `#tags` and frontmatter `tags:` |
| `Frontmatter` | `path: string, key: string, value: string`     | each YAML frontmatter key (arrays expand to one row per item) |
| `CodeBlock`   | `path: string, lang: string, line: number`     | fenced code blocks (excluding `datalog` / `datalog-query`) |

Notes:

- `path` is always vault-relative (e.g. `schema.md`), and joins everything together.
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

See [[writing-queries]] for how the variable names above become the table's
column headers.
