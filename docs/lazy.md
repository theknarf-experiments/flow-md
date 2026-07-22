---
title: Lazy features, in a vault
tags: [plan]
order: 11
---

# Lazy features, in a vault

[Lazy](https://lazy.so/) is a capture tool for knowledge: ⌘L grabs whatever
you're looking at, it lands as a card with its source attached, and the cards
nest, filter, and get rewritten by AI commands.

Most of that is a database, a sync layer and a clipper. flow-md already has
the first two — the vault *is* the database and the Datalog server *is* the
sync — and the browser is where a clipper would live anyway. So this is
mostly a mapping exercise, not a rebuild:

| Lazy | Here |
| --- | --- |
| Card | A block with a `^ULID` — the same identity tabs already use |
| Nested cards | List indentation, which the tab tree already reads |
| Universal clipper | A content script in the guest + a fact write |
| Source metadata | The link and frontmatter written with the clip |
| Attributes (People, Sources…) | Frontmatter and inline tags → relations |
| Filters | Datalog queries, saved as query blocks in a note |
| Pinboard | `pinned:` frontmatter and `PinnedGrid`, already built |
| Tasks | `Task(path, status, text, line)`, already parsed |
| Graph view | `packages/view-graph`, already built |
| AI commands | An https call from the shell, writing markdown back |

What genuinely doesn't map: capture from *other desktop apps*, and mobile.
An Isolated Web App can only see its own guests. Capture beyond the browser
needs the Rust launcher to grow a global hotkey — that's phase 5, and it's
the one place this stops being a mapping exercise.

## Phase 1 — Capture

The centre of the product. Everything else is what happens to a clip after.

- [ ] `capture` action: a guest script that reads the selection, its HTML, the
      page url, title, favicon and time
- [ ] Selection HTML → markdown, so a clipped list stays a list
- [ ] Write the clip to an inbox note as a block with a `^ULID` and a source link
- [ ] Site-aware extractors: tweet (author, text, thread), YouTube (video id and
      the timestamp you were at), PDF (page number), article (byline, canonical url)
- [ ] Capture with no selection = the whole readable article
- [ ] A toast in the guest confirming the clip, so nothing about it needs the shell

## Phase 2 — Cards and triage

- [ ] `Card` rules over blocks that carry an id, so a clip and a tab are the
      same kind of thing to a query
- [ ] Inbox triage: move a clip into another note, keeping its id and source
- [ ] Due dates — parse `@due(2026-07-30)` into a `TaskDue` relation
- [ ] Reuse `view-kanban` over tasks by status

## Phase 3 — Finding things again

- [ ] Vault-wide search in the shell's ⌘K, over `MdNodeText`
- [ ] Saved filters: a query block in a note *is* a saved filter, so this is
      mostly a matter of rendering one in the sidebar
- [ ] Pin any card, not just tabs — the grid already exists
- [ ] Backlinks relation, and point `view-graph` at it

## Phase 4 — Journal and AI

- [ ] Daily note: today's file, made on demand, bound to a key
- [ ] AI commands over a block (summarise, title, tag), writing the answer back
      as a child block so the source stays intact
- [ ] Keys read from the config mount, never the vault

## Phase 5 — Beyond the browser

- [ ] Global hotkey in the Rust launcher, capturing the system selection
- [ ] Publish a note as a page

## Why this is worth doing here

Lazy's cards live in Lazy. These live in files you already own, in a format
that outlives the app, and every filter is a query you can read. The browser
being the capture surface isn't a bolt-on either — the tabs are already
markdown, so a clip and the page it came from end up in the same document.
