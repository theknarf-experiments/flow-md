// EDB schema contributed by the markdown plugin: what the parser *reads out
// of a file*, as opposed to what can be said about it.
//
// That's the tree (MdNode and friends) plus the two things a rule can't
// derive — YAML frontmatter, and the wiki-links and #tags scraped from text
// with a regex. Heading, Task, Link, Tag and the rest are views over these;
// see rules.ts.
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
    // Frontmatter is YAML — another language, parsed by the plugin rather
    // than derived from the tree, since Datalog can't parse.
    name: 'Frontmatter',
    attrs: [['path', 'string'], ['key', 'string'], ['value', 'string']],
  },
  {
    name: 'FrontmatterNumber',
    attrs: [['path', 'string'], ['key', 'string'], ['num', 'float']],
  },
  {
    // `[[wiki]]` links and #tags are scraped from text with a regex, which is
    // likewise not something a rule can do. The friendly Link/Tag relations
    // are rules that read these alongside the tree — see rules.ts.
    name: 'MdWikiLink',
    attrs: [
      ['path', 'string'],
      ['dst', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  {
    name: 'MdInlineTag',
    attrs: [['path', 'string'], ['tag', 'string'], ['line', 'number']],
  },
]
