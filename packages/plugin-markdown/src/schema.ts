// EDB schema contributed by the markdown plugin. Every relation here is
// emitted by parseMarkdown; together they describe the structure of a vault
// of markdown notes (files, headings, links, tags, frontmatter, code blocks,
// task-list items).

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
