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
