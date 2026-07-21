// The friendly relations, defined over the syntax tree rather than emitted
// alongside it. A heading is a node of type "heading" with a depth; a task is
// a list item with a checkbox. Saying so in Datalog means there's one source
// of truth — the tree — and these are views of it.
//
// Two things stay facts because Datalog can't derive them: frontmatter (YAML
// is another language, parsed by the plugin) and the regex-scraped `[[wiki]]`
// links and #tags. Their relations are named Md* and the views below read
// them like any other input.

import type { EdbDef } from '@flow-md/plugin-api'

export const MARKDOWN_RULES: string[] = [
  `Heading(path, level, text, line) :-
     MdNode(path, id, _, "heading", line, _, _),
     MdPropNum(path, id, "depth", level),
     MdNodeText(path, id, text).`,

  // One rule, not one per state: a column whose value differs by rule can't
  // be traced back to the cell it came from, and toggling a checkbox from a
  // Task query is exactly that trace.
  //
  // The text is the item's own paragraph, so a nested sub-item's text doesn't
  // bleed into its parent's. An item with two paragraphs yields two rows —
  // rare, and the alternative (min over the children) is an aggregate the
  // write path can't see through, which would cost every Task its writable
  // text column.
  `Task(path, status, text, line) :-
     MdNode(path, id, _, "listItem", line, _, _),
     MdProp(path, id, "status", status),
     MdNode(path, para, id, "paragraph", _, _, _),
     MdNodeText(path, para, text).`,

  // One rule, covering `[md](url)` and `[[wiki]]` alike — the parser marks
  // both with a `link` property, so this doesn't need to know the syntax.
  // Two rules would also work, and would cost both views their writability:
  // lineage can only trace a column through a single definition.
  `Link(path, dst, kind) :-
     MdNode(path, id, _, _, _, _, _),
     MdProp(path, id, "link", kind),
     MdProp(path, id, "url", dst).`,

  `LinkLabel(path, dst, text, line) :-
     MdNode(path, id, _, _, line, _, _),
     MdProp(path, id, "link", _),
     MdProp(path, id, "url", dst),
     MdNodeText(path, id, text).`,

  // The two langs that feed the engine are the program, not content.
  `CodeBlock(path, lang, line) :-
     MdNode(path, id, _, "code", line, _, _),
     MdProp(path, id, "lang", lang),
     lang != "datalog",
     lang != "datalog-query".`,

  `Tag(path, tag) :- MdInlineTag(path, tag, _).`,
  `Tag(path, tag) :- Frontmatter(path, "tags", tag).`,
  `Tag(path, tag) :- Frontmatter(path, "tag", tag).`,
]

/** What those rules define. The vault needs the column names to validate
 *  writes, trace lineage and show the schema; they aren't EDB relations. */
export const MARKDOWN_DERIVED: EdbDef[] = [
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
    name: 'Task',
    attrs: [
      ['path', 'string'],
      ['status', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  {
    name: 'Link',
    attrs: [['src', 'string'], ['dst', 'string'], ['kind', 'string']],
  },
  {
    name: 'LinkLabel',
    attrs: [
      ['src', 'string'],
      ['dst', 'string'],
      ['text', 'string'],
      ['line', 'number'],
    ],
  },
  { name: 'CodeBlock', attrs: [['path', 'string'], ['lang', 'string'], ['line', 'number']] },
  { name: 'Tag', attrs: [['path', 'string'], ['tag', 'string']] },
]
