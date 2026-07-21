---
title: Examples
tags: [reference]
order: 8
---

# Examples

A cookbook of rules and queries that run against *this* vault. Each `datalog`
block defines a relation; the `datalog-query` block under it shows the result.

## Tags per page

Flatten the `Tag` relation into a tidy two-column view:

```datalog
PageTag(path, tag) :- Tag(path, tag).
```

```datalog-query
PageTag(path, tag)
```

## Top-level headings (the table of contents)

Project every level-1 heading. `line` is in the body but not the head, so it's a
join key we don't display:

```datalog
TopHeading(path, title) :- Heading(path, 1, title, line).
```

```datalog-query
TopHeading(path, title)
```

## Pages by tag class

Two relations over the same EDB, queried together by class:

```datalog
ReferencePage(path) :- Tag(path, "reference").
```

```datalog-query
ReferencePage(path)
```

## The wiki-link graph

Every `[[wiki]]` link in the vault, as `(source, raw target)`. Remember
`Link.dst` is the unresolved target text (see [[schema]]):

```datalog
WikiLink(src, dst) :- Link(src, dst, "wiki").
```

```datalog-query
WikiLink(src, dst)
```

## Links with their names

`Link` is the bare edge — source, target, kind — which is what you want when
you're treating the vault as a graph. What a link *says* lives in `LinkLabel`,
alongside the line it sits on, so join the two when you want names:

```datalog
NamedLink(src, dst, text) :-
  Link(src, dst, "md"), LinkLabel(src, dst, text, _).
```

```datalog-query
NamedLink(src, dst, text)
```

Keeping them apart means `Link(src, dst, kind)` still reads as a graph, and a
page linked twice under different names is two `LinkLabel` rows rather than a
duplicated edge. `LinkLabel` is also the writable one: its line number pins an
edit to one occurrence, which a bare `Link` can't do when the same URL appears
more than once.

## Co-tagged pages

Pairs of distinct pages that share a tag — a join of `Tag` with itself, using a
comparison to drop `(a, a)` pairs:

```datalog
CoTagged(a, b, tag) :- Tag(a, tag), Tag(b, tag), a != b.
```

```datalog-query
CoTagged(a, b, tag)
```

## Try it yourself

Add a tag to any page's frontmatter, save, and watch `PageTag` and `CoTagged`
update. Add a new `[[link]]` and watch `WikiLink` grow. That incremental
re-evaluation is the whole point — see [[writing-rules]] for what else you can
express.
