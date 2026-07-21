// EDB schema contributed by the markdown plugin. Every relation here is
// emitted by parseMarkdown; together they describe the structure of a vault
// of markdown notes (files, headings, links, tags, frontmatter, code blocks,
// task-list items).
//
// Attribute order is load-bearing: update.ts maps a relation's writable
// column names back to row indices through this table.

import type { EdbDef } from '@flow-md/plugin-api'

export const MARKDOWN_SCHEMA: EdbDef[] = [
  { name: 'File', attrs: [['path', 'string'], ['mtime', 'number']] },

  // --- the syntax tree, as relations ---------------------------------------
  //
  // Every node of the parsed document, its properties and its text. The
  // relations above are views over this: a heading is a node of type
  // "heading" with a depth, a task is a list item with a checkbox. Query it
  // directly when you want something nobody thought to name.
  {
    name: 'MdNode',
    attrs: [
      ['path', 'string'],
      ['id', 'number'],
      ['parent', 'number'],
      ['type', 'string'],
      ['line', 'number'],
      ['start', 'number'],
      ['end', 'number'],
    ],
  },
  {
    // A node's rendered text: for a leaf, what it says; for a parent, its
    // subtree flattened. Rewritable only where the source says it literally —
    // "bold task" is what `**bold** task` renders as, not what's written, so
    // that row is read-only and you edit the text node inside it instead.
    name: 'MdNodeText',
    attrs: [['path', 'string'], ['id', 'number'], ['text', 'string']],
  },
  {
    // Whatever the parser hung on the node: a link's url, a fence's lang, a
    // checkbox's state. Not an enumerated list — anything scalar shows up.
    name: 'MdProp',
    attrs: [
      ['path', 'string'],
      ['id', 'number'],
      ['key', 'string'],
      ['value', 'string'],
    ],
  },
  {
    // The numeric ones, typed, so rules can compare and aggregate them.
    name: 'MdPropNum',
    attrs: [
      ['path', 'string'],
      ['id', 'number'],
      ['key', 'string'],
      ['num', 'float'],
    ],
  },

  {
    name: 'Heading',
    attrs: [
      ['path', 'string'],
      ['level', 'number'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  {
    name: 'Link',
    attrs: [['src', 'string'], ['dst', 'string'], ['kind', 'string']],
  },
  {
    // The same links, carrying what the reader actually sees and where it
    // sits. Separate from Link so the edge relation stays a plain graph to
    // join on, and so `Link(src, dst, kind)` keeps working: join the two when
    // you want names, e.g.
    //   Tab(dst, text, line) :-
    //     Link(p, dst, "md"), LinkLabel(p, dst, text, line).
    name: 'LinkLabel',
    attrs: [
      ['src', 'string'],
      ['dst', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  { name: 'Tag', attrs: [['path', 'string'], ['tag', 'string']] },
  {
    name: 'Frontmatter',
    attrs: [['path', 'string'], ['key', 'string'], ['value', 'string']],
  },
  {
    name: 'FrontmatterNumber',
    attrs: [['path', 'string'], ['key', 'string'], ['num', 'float']],
  },
  {
    name: 'CodeBlock',
    attrs: [['path', 'string'], ['lang', 'string'], ['line', 'number']],
  },
  {
    // GFM task-list items: status is "open" (- [ ]) or "closed" (- [x]).
    name: 'Task',
    attrs: [
      ['path', 'string'],
      ['status', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
]
