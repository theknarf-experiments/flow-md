---
title: Schemaboi
tags: [reference, example]
order: 11
---

# Schemaboi files

[Schemaboi](https://github.com/josephg/schemaboi) is a binary serialization
format whose schema travels *inside* the file. That makes `.sb` files a
perfect flow-md citizen: one parse yields two fact families — the **schema**
(what shapes exist) and the **data** (what the file holds) — and both are
ordinary Datalog relations you can query from any note.

This vault contains [[contacts.sb|contacts.sb]] (regenerate it with
`node packages/plugin-schemaboi/scripts/make-example.mjs`). Opening it in the
app shows the schemaboi inspector; the same view embeds in MDX as
`<Schemaboi path="contacts.sb" />`.

## Querying the schema

Every named type, with structs and enums told apart:

```datalog-query
SbType(path, type, kind)
```

Fields are per-variant (a struct is an enum with one `Default` variant in
the wire format). `ftype` is the field's type — a primitive, a type name,
or `list<T>` / `map<K,V>`:

```datalog-query
SbField(path, type, variant, field, ftype, optional)
```

## Querying the data

Decoded values are items with JSONPath-ish ids (`$` is the root,
`$.contacts[0]` the first element of its `contacts` list). Scalar fields
hang off their item as `SbData`; numbers also land in `SbNum`; nesting is
`SbLink` edges:

```datalog-query
SbData(path, item, field, value)
```

Schema and data join like any relations — here, every contact's name next
to its color (a fieldless enum decodes to its variant name):

```datalog
ContactColor(name, color) :-
  SbItem(path, item, "Contact", variant),
  SbData(path, item, "name", name),
  SbData(path, item, "color", color).
```

```datalog-query
ContactColor(name, color)
```

Numbers query as numbers — ages over 30, via the `SbNum` sidecar:

```datalog
Over30(name, age) :-
  SbItem(path, item, "Contact", variant),
  SbData(path, item, "name", name),
  SbNum(path, item, "age", age),
  age > 30.
```

```datalog-query
Over30(name, age)
```

A corrupt or unreadable `.sb` file doesn't break the vault — it shows up in
`SbError(path, error)` instead.
