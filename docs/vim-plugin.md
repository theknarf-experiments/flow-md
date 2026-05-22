---
title: Vim plugin
tags: [guide]
---

# Vim plugin

`@flow-md/vim` renders query results inline, as virtual-text markdown tables
below each `datalog-query` block. It is **pure Vimscript** (no Python, no curl),
talks to the server over Vim's built-in channel API, and **never modifies your
files** — the tables are display-only text properties.

## Requirements

- **Vim 9.0.0067+** (classic Vim, not Neovim) with `+textprop` and `+channel`.
- A running `flow-md serve` (see [[getting-started]]).

## Install

The plugin lives in `packages/vim`. Add it to your runtimepath however you
manage plugins. With Vim's built-in package manager:

```bash
mkdir -p ~/.vim/pack/flow-md/start
ln -s /path/to/flow-md/packages/vim ~/.vim/pack/flow-md/start/flow-md
```

Or with a plugin manager, point it at the `packages/vim` directory.

## Configure

```vim
" host:port of `flow-md serve` (default shown)
let g:flowmd_server = 'localhost:4747'

" set to 0 to stop auto-refresh on open/save
let g:flowmd_enabled = 1

" set to 0 to leave 'smoothscroll' untouched (see below)
let g:flowmd_smoothscroll = 1
```

Because the result tables are virtual text *below* a line, a query block is
taller than one screen row. To make scrolling through them behave, the plugin
sets two Vim options when it renders (both gated by `g:flowmd_smoothscroll`):

- `'smoothscroll'` (window-local) — scroll one screen row at a time instead of a
  whole buffer line, so tall blocks don't jump past in a single step.
- `'display'` += `lastline` (global) — without this, a tall line that only
  partly fits the window is replaced by `@` filler lines; with it, the table is
  shown truncated (a small `@@@` marks the cut) and scrolls into view smoothly.
- `'showbreak'` cleared (window-local) — otherwise, when a table is partly
  scrolled, Vim prefixes its top row with your `showbreak` marker and indent (as
  if it were a wrapped line), shoving the table to the right.

Set `g:flowmd_smoothscroll = 0` to leave all three options untouched.

**Known limitation:** with `smoothscroll` on, Vim treats the stack of table rows
as one wrapped virtual line and can scroll into the middle of it, so at some
scroll offsets the top partially-visible row shifts right or shows a fragment.
This is a Vim rendering limitation of `smoothscroll` + "below" virtual text, not
fixable from the plugin. Turn `smoothscroll` off (above) to trade it for
block-at-a-time scrolling instead.

The plugin sends each buffer's **absolute path** to the server, which resolves
it against the vault root it was started with. So you can launch Vim from any
directory — there's no working-directory or vault-root setting to get right.

## Use

Open a markdown file in the vault. Results render on open and after each save.

| Command          | Effect                                  |
|------------------|-----------------------------------------|
| `:FlowmdRefresh` | re-fetch and redraw the current buffer  |
| `:FlowmdClear`   | remove flow-md's virtual text           |

A query block ends up looking like this in your editor (the table is virtual
text, not part of the file):

```
```datalog-query
GuidePage(path)
```
| path                | 
| ------------------- |
| getting-started.md  |
| vim-plugin.md       |
2 rows
```

The highlight group is `flowmdTable` (linked to `Comment` by default); override
it to taste.
