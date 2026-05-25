---
title: Tasks
tags: [reference]
order: 9
---

# Tasks

Markdown task-list items — `- [ ]` (open) and `- [x]` (closed) — become `Task`
facts. That lets you pull every todo scattered across the whole vault into one
list, no matter which note it lives in.

```
Task(path: string, status: string, text: string, line: number)
```

`status` is `"open"` or `"closed"`; `text` is the item's description; `line` is
where it sits in its file (handy for jumping to it).

## Every todo in the vault

The list you usually want: each todo with its **file**, **description**, and
**status**. A one-line rule reorders the columns into that shape:

```datalog
Todo(file, description, status) :- Task(file, status, description, line).
```

```datalog-query
Todo(file, description, status)
```

The result spans every note — the items below on this page, the checkboxes on
[[roadmap]], and anything you add elsewhere.

## Just the open ones

Pin the status with a constant to see only what's left to do, with its location:

```datalog-query
Task(path, "open", text, line)
```

## Some todos on this page

- [ ] document the aggregation operators
- [x] write the tasks example
